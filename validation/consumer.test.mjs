import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { cases, CORE_COMMIT, BASELINE_COMMIT } from './cases.mjs';
import * as core from '../tmp/core/langs/typescript/src/index.js';
import * as baseline from '../tmp/baseline/langs/typescript/src/index.js';

test('both external source checkouts have the exact reviewed identities', () => {
  for (const [dir, sha] of [['tmp/core', CORE_COMMIT], ['tmp/baseline', BASELINE_COMMIT]]) {
    assert.equal(execFileSync('git', ['-C', dir, 'rev-parse', 'HEAD'], { encoding: 'utf8' }).trim(), sha);
    assert.equal(execFileSync('git', ['-C', dir, 'status', '--porcelain', '--untracked-files=no'], { encoding: 'utf8' }), '');
  }
});
test('external TypeScript entrypoints replay the shared corpus and normalized output', () => {
  const rows = cases();
  assert(rows.length > 3000);
  for (const row of rows) {
    if (row.kind === 'correlation') assert.equal(core.validCorrelationId(row.input), row.expected, row.id);
    else if (row.expected === null) assert.throws(() => core.normalizeEmailForRevocation(row.input), TypeError, row.id);
    else {
      const output = core.normalizeEmailForRevocation(row.input);
      assert.equal(output, row.expected, row.id);
      assert.equal(core.normalizeEmailForRevocation(output), output, `idempotent ${row.id}`);
    }
  }
});
test('runtime inputs are not silently string-coerced', () => {
  for (const value of [null, undefined, 0, true, {}, [], new String('a@example.com'), { toString: () => 'a@example.com' }]) {
    assert.throws(() => core.normalizeEmailForRevocation(value), TypeError);
    assert.equal(core.validCorrelationId(value), false);
  }
});
test('unpaired UTF-16 surrogates are rejected instead of normalized', () => {
  for (const value of ['\ud800@example.com', 'a@\udfff.example', 'request-\ud800']) {
    assert.throws(() => core.normalizeEmailForRevocation(value), TypeError);
    assert.equal(core.validCorrelationId(value), false);
  }
});
test('every byte value at every digest position preserves replay/conflict and input bytes', () => {
  const stored = new Uint8Array(32);
  assert.equal(core.classifyIdempotency(undefined, stored), 'new');
  for (let index = 0; index < 32; index += 1) {
    for (let byte = 0; byte < 256; byte += 1) {
      const incoming = new Uint8Array(32);
      incoming[index] = byte;
      const before = incoming.slice();
      assert.equal(core.classifyIdempotency(stored, incoming), byte === 0 ? 'replay' : 'conflict');
      assert.deepEqual(incoming, before);
      assert.deepEqual(stored, new Uint8Array(32));
    }
  }
});
test('invalid incoming and stored digest representations fail before classification', () => {
  const bad = [null, [], Array(32).fill(0), new Uint16Array(32), new Int8Array(32), new DataView(new ArrayBuffer(32)), new Uint8Array(31), new Uint8Array(33)];
  for (const value of bad) {
    assert.throws(() => core.classifyIdempotency(undefined, value), TypeError);
    assert.throws(() => core.classifyIdempotency(new Uint8Array(32), value), TypeError);
    assert.throws(() => core.classifyIdempotency(value, new Uint8Array(32)), TypeError);
  }
  const detached = new Uint8Array(32);
  structuredClone(detached, { transfer: [detached.buffer] });
  assert.throws(() => core.classifyIdempotency(undefined, detached), TypeError);
});
test('the known old Unicode defect is reproduced and the candidate rejects it', () => {
  for (const [input, oldOutput] of [['\u212a@example.com', 'k@example.com'], ['a@\u212a.example', 'a@k.example']]) {
    assert.equal(baseline.normalizeEmailForRevocation(input), oldOutput);
    assert.throws(() => core.normalizeEmailForRevocation(input), TypeError);
  }
});
test('validation diagnostics omit the synthetic rejected secret-shaped value', () => {
  const input = 'private-\u212a@example.com';
  assert.throws(() => core.normalizeEmailForRevocation(input), error => error instanceof TypeError && !String(error).includes(input));
});
