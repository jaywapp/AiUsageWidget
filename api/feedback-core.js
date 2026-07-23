'use strict';

const crypto = require('node:crypto');

const REPOSITORY = 'jaywapp/AiUsageWidget';
const LABEL = '제보';
const MAX_BODY_BYTES = 16 * 1024;
const PROOF_DIFFICULTY = 4;
const PROOF_MAX_AGE_MS = 5 * 60 * 1000;
const RATE_LIMIT_WINDOW_MS = 15 * 60 * 1000;
const RATE_LIMIT_MAX = 3;

function cleanText(value, maxLength) {
  if (typeof value !== 'string') return '';
  return value
    .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, '')
    .trim()
    .slice(0, maxLength);
}

function validatePayload(input, now = Date.now()) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) {
    return { ok: false, status: 400, message: '요청 형식이 올바르지 않습니다.' };
  }
  if (input.website) {
    return { ok: false, status: 400, message: '요청을 처리할 수 없습니다.' };
  }
  if (input.repository !== REPOSITORY) {
    return { ok: false, status: 400, message: '허용되지 않은 저장소입니다.' };
  }

  const title = cleanText(input.title, 120);
  const description = cleanText(input.description, 6000);
  const contact = cleanText(input.contact, 200);
  const appVersion = cleanText(input.appVersion, 40);
  const platform = cleanText(input.platform, 20);
  if (!title || !description) {
    return { ok: false, status: 400, message: '제목과 내용은 필수입니다.' };
  }
  if (platform !== 'windows') {
    return { ok: false, status: 400, message: '허용되지 않은 플랫폼입니다.' };
  }
  if (!verifyProof(input.proof, title, description, now)) {
    return { ok: false, status: 400, message: '스팸 방지 검증에 실패했습니다.' };
  }

  return { ok: true, value: { title, description, contact, appVersion, platform } };
}

function verifyProof(proof, title, description, now = Date.now()) {
  if (!proof || !Number.isSafeInteger(proof.timestamp) || !Number.isSafeInteger(proof.nonce)) {
    return false;
  }
  if (proof.nonce < 0 || Math.abs(now - proof.timestamp) > PROOF_MAX_AGE_MS) {
    return false;
  }
  const digest = crypto
    .createHash('sha256')
    .update(`${proof.timestamp}:${proof.nonce}:${title}:${description}`, 'utf8')
    .digest('hex');
  return digest.startsWith('0'.repeat(PROOF_DIFFICULTY));
}

function buildIssueBody(value) {
  const lines = [
    value.description,
    '',
    '---',
    `앱 버전: ${value.appVersion || 'unknown'}`,
    `플랫폼: ${value.platform}`
  ];
  if (value.contact) lines.push(`연락처(사용자 제공): ${value.contact}`);
  return lines.join('\n');
}

function createRateLimiter(now = () => Date.now()) {
  const buckets = new Map();
  return function consume(key) {
    const current = now();
    const recent = (buckets.get(key) || []).filter(time => current - time < RATE_LIMIT_WINDOW_MS);
    if (recent.length >= RATE_LIMIT_MAX) {
      buckets.set(key, recent);
      return false;
    }
    recent.push(current);
    buckets.set(key, recent);
    return true;
  };
}

function isAllowedOrigin(origin, allowedOrigins) {
  if (!origin) return true;
  return allowedOrigins.includes(origin);
}

function getClientKey(req) {
  const forwarded = req.headers['x-forwarded-for'];
  return String(Array.isArray(forwarded) ? forwarded[0] : forwarded || req.socket?.remoteAddress || 'unknown')
    .split(',')[0]
    .trim()
    .slice(0, 80);
}

function sendJson(res, status, body) {
  res.statusCode = status;
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.setHeader('Cache-Control', 'no-store');
  res.end(JSON.stringify(body));
}

function createHandler(options = {}) {
  const fetchImpl = options.fetchImpl || globalThis.fetch;
  const now = options.now || (() => Date.now());
  const consumeRateLimit = options.consumeRateLimit || createRateLimiter(now);

  return async function handler(req, res) {
    if (req.method !== 'POST') {
      res.setHeader('Allow', 'POST');
      return sendJson(res, 405, { message: 'POST 요청만 허용됩니다.' });
    }

    const contentLength = Number(req.headers['content-length'] || 0);
    if (contentLength > MAX_BODY_BYTES) {
      return sendJson(res, 413, { message: '요청 본문이 너무 큽니다.' });
    }

    const allowedOrigins = String(process.env.ALLOWED_ORIGINS || '')
      .split(',')
      .map(value => value.trim())
      .filter(Boolean);
    if (!isAllowedOrigin(req.headers.origin, allowedOrigins)) {
      return sendJson(res, 403, { message: '허용되지 않은 출처입니다.' });
    }
    if (!consumeRateLimit(getClientKey(req))) {
      return sendJson(res, 429, { message: '요청이 너무 많습니다. 잠시 후 다시 시도하세요.' });
    }

    const validation = validatePayload(req.body, now());
    if (!validation.ok) {
      return sendJson(res, validation.status, { message: validation.message });
    }
    if (!process.env.GITHUB_ISSUES_TOKEN) {
      return sendJson(res, 503, { message: '제보 서버가 준비되지 않았습니다.' });
    }

    const value = validation.value;
    let githubResponse;
    try {
      githubResponse = await fetchImpl(`https://api.github.com/repos/${REPOSITORY}/issues`, {
        method: 'POST',
        headers: {
          Accept: 'application/vnd.github+json',
          Authorization: `Bearer ${process.env.GITHUB_ISSUES_TOKEN}`,
          'Content-Type': 'application/json',
          'User-Agent': 'ai-usage-feedback-relay',
          'X-GitHub-Api-Version': '2022-11-28'
        },
        body: JSON.stringify({
          title: `[제보] ${value.title}`,
          body: buildIssueBody(value),
          labels: [LABEL]
        })
      });
    } catch {
      return sendJson(res, 502, { message: 'GitHub에 연결할 수 없습니다.' });
    }

    if (!githubResponse.ok) {
      return sendJson(res, 502, { message: 'GitHub Issue를 만들지 못했습니다.' });
    }

    const issue = await githubResponse.json();
    return sendJson(res, 201, {
      issueNumber: issue.number,
      issueUrl: issue.html_url,
      message: '제보가 등록되었습니다.'
    });
  };
}

module.exports = {
  REPOSITORY,
  LABEL,
  MAX_BODY_BYTES,
  PROOF_DIFFICULTY,
  buildIssueBody,
  cleanText,
  createHandler,
  createRateLimiter,
  validatePayload,
  verifyProof
};
