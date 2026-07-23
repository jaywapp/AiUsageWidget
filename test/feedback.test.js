'use strict';

const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const test = require('node:test');
const {
  REPOSITORY,
  createHandler,
  createRateLimiter,
  validatePayload
} = require('../api/feedback-core');

function createProof(timestamp, title, description) {
  for (let nonce = 0; ; nonce++) {
    const digest = crypto
      .createHash('sha256')
      .update(`${timestamp}:${nonce}:${title}:${description}`, 'utf8')
      .digest('hex');
    if (digest.startsWith('0000')) return { timestamp, nonce };
  }
}

function validPayload(now) {
  const title = '화면이 갱신되지 않음';
  const description = '새 로그가 생겨도 수치가 바뀌지 않습니다.';
  return {
    repository: REPOSITORY,
    title,
    description,
    contact: '',
    appVersion: '1.0.0',
    platform: 'windows',
    diagnostics: {},
    website: '',
    proof: createProof(now, title, description)
  };
}

function mockResponse() {
  return {
    headers: {},
    setHeader(name, value) { this.headers[name] = value; },
    end(body) { this.body = JSON.parse(body); }
  };
}

test('validatePayload: fixed repository and required fields', () => {
  const now = Date.now();
  assert.equal(validatePayload(validPayload(now), now).ok, true);
  assert.equal(validatePayload({ ...validPayload(now), repository: 'other/repo' }, now).ok, false);
  assert.equal(validatePayload({ ...validPayload(now), title: '' }, now).ok, false);
});

test('handler: creates an issue with forced prefix and label', async () => {
  const now = Date.now();
  let githubRequest;
  const handler = createHandler({
    now: () => now,
    consumeRateLimit: () => true,
    fetchImpl: async (url, options) => {
      githubRequest = { url, options };
      return {
        ok: true,
        async json() { return { number: 42, html_url: 'https://github.com/example/issues/42' }; }
      };
    }
  });
  const previousToken = process.env.GITHUB_ISSUES_TOKEN;
  process.env.GITHUB_ISSUES_TOKEN = 'test-token';
  try {
    const req = {
      method: 'POST',
      headers: { 'x-forwarded-for': '127.0.0.1' },
      body: validPayload(now),
      socket: {}
    };
    const res = mockResponse();
    await handler(req, res);

    assert.equal(res.statusCode, 201);
    assert.equal(res.body.issueNumber, 42);
    assert.match(githubRequest.url, /jaywapp\/AiUsageWidget\/issues$/);
    const issue = JSON.parse(githubRequest.options.body);
    assert.equal(issue.title, '[제보] 화면이 갱신되지 않음');
    assert.deepEqual(issue.labels, ['제보']);
    assert.doesNotMatch(issue.body, /test-token/);
  } finally {
    if (previousToken === undefined) delete process.env.GITHUB_ISSUES_TOKEN;
    else process.env.GITHUB_ISSUES_TOKEN = previousToken;
  }
});

test('rate limiter rejects the fourth request in a window', () => {
  const limiter = createRateLimiter(() => 1000);
  assert.equal(limiter('client'), true);
  assert.equal(limiter('client'), true);
  assert.equal(limiter('client'), true);
  assert.equal(limiter('client'), false);
});
