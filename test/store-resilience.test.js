'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { parseClaudeLine, parseCodexFile, UsageStore } = require('../lib/store');

test('malformed token fields never poison aggregate totals', () => {
  const record = parseClaudeLine(JSON.stringify({
    type: 'assistant', timestamp: '2026-01-01T00:00:00Z',
    message: { model: { name: 'invalid' }, usage: { input_tokens: '10', output_tokens: -3, cache_read_input_tokens: {}, cache_creation_input_tokens: 5 } },
  }));
  assert.equal(record.model, 'unknown');
  assert.equal(record.input, 0);
  assert.equal(record.output, 0);
  assert.equal(record.cacheRead, 0);
  const store = new UsageStore();
  store.fileCache.set('fixture', { source: 'claude', records: [record] });
  assert.equal(store.buildSummary(record.ts).kpi.total.claude.tokens, 5);
});

test('Codex malformed counters use zero and malformed models retain the previous model', () => {
  const content = [
    { type: 'turn_context', payload: { model: 'gpt-test' } },
    { type: 'turn_context', payload: { model: {} } },
    { timestamp: '2026-01-01T00:00:00Z', payload: { type: 'token_count', info: { total_token_usage: { input_tokens: 'oops', output_tokens: 2, cached_input_tokens: -10 } } } },
  ].map(JSON.stringify).join('\n');
  const { records } = parseCodexFile(content);
  assert.equal(records[0].model, 'gpt-test');
  assert.equal(records[0].input, 0);
  assert.equal(records[0].output, 2);
  assert.equal(records[0].cacheRead, 0);
});

test('empty and unreadable sources preserve the zero summary', () => {
  const store = new UsageStore({ claudeDir: __filename });
  store.refresh();
  const summary = store.buildSummary(Date.UTC(2026, 0, 1));
  assert.equal(summary.sources.claude.available, false);
  assert.deepEqual(summary.models, []);
  assert.equal(summary.kpi.total.claude.tokens, 0);
  assert.equal(summary.plan.claude.pct5h, 0);
});
