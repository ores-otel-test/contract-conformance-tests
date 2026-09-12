import assert from 'node:assert/strict';
import { readdir, readFile } from 'node:fs/promises';
import { join } from 'node:path';

const reportPath = process.env.OTEL_TJSV_REPORT ?? 'tmp/otel-peer/report.json';
const generatedRoot = process.env.OTEL_TJSV_GENERATED ?? 'tmp/otel-peer/generated';
const report = JSON.parse(await readFile(reportPath, 'utf8'));

assert.equal(report.schema, 'ores.typespec-json-schema-validator.report/v1');
assert.equal(report.status, 'passed');
assert.equal(report.zeroUnexplainedFindings, true);
assert.deepEqual(report.findings, []);
assert.ok(Array.isArray(report.declarationMap) && report.declarationMap.length >= 1);

const summary = report.differential?.summary;
assert.ok(summary && typeof summary === 'object', 'differential summary must be present');
assert.ok(summary.comparedDeclarations >= 1, 'at least one declaration must be compared');
assert.ok(summary.probesEvaluated >= 1, 'differential probes must execute');
assert.equal(summary.divergences, 0, 'Schema B and authored Schema A must not diverge');
assert.equal(summary.refusals, 0, 'comparison must not refuse probes');
assert.ok(summary.agreements >= 1, 'the two JSON Schema lanes must agree on probes');
assert.ok(summary.corpusInstances >= 2, 'positive and negative instance corpus must execute');

async function jsonFiles(root) {
  const result = [];
  for (const entry of await readdir(root, { withFileTypes: true })) {
    const path = join(root, entry.name);
    if (entry.isDirectory()) result.push(...await jsonFiles(path));
    else if (entry.isFile() && entry.name.endsWith('.json')) result.push(path);
  }
  return result;
}

const generated = await jsonFiles(generatedRoot);
assert.ok(generated.length >= 1, 'TypeSpec must transpile to at least one comparison JSON Schema B file');

const authored = JSON.parse(await readFile('otel-peer-authority/authored.schema.json', 'utf8'));
assert.equal(authored.$schema, 'https://json-schema.org/draft/2020-12/schema');
assert.ok(authored.$defs?.OtelPolicyCanary, 'authored Schema A must remain independently present');

console.log(JSON.stringify({
  status: report.status,
  generatedSchemaBFiles: generated.length,
  comparedDeclarations: summary.comparedDeclarations,
  probesEvaluated: summary.probesEvaluated,
  agreements: summary.agreements,
  divergences: summary.divergences,
  refusals: summary.refusals,
  corpusInstances: summary.corpusInstances,
}));
