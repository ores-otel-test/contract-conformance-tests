import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { createHash } from 'node:crypto';
import { cp, mkdir, readFile, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { promisify } from 'node:util';
import { buildCases } from './cases.mjs';

assert.equal(process.argv.length, 2, 'runtime conformance task accepts no options');
const exec = promisify(execFile);
const root = resolve(import.meta.dirname, '..');
const sourceRoot = join(root, 'tmp/interfaces');
const validatorRoot = join(root, 'tmp/tjsv');
const evidenceRoot = join(root, 'tmp/evidence');
const run = (command, args, options = {}) => exec(command, args,
  { cwd: options.cwd ?? root, env: options.env ?? process.env, timeout: 180000, maxBuffer: 16 * 1024 * 1024 });
const hash = (value) => createHash('sha256').update(value).digest('hex');
const clone = (value) => structuredClone(value);
await mkdir(evidenceRoot, { recursive: true });

const expectedSource = '09b06c7d82852b657e812a70eeb63023d0aed2a6';
const expectedValidator = 'd60d0d79d83e075077382623ec9e23a401ab601f';
assert.equal((await run('git', ['-C', sourceRoot, 'rev-parse', 'HEAD'])).stdout.trim(), expectedSource);
assert.equal((await run('git', ['-C', validatorRoot, 'rev-parse', 'HEAD'])).stdout.trim(), expectedValidator);

const cases = buildCases();
const corpusPath = join(evidenceRoot, 'runtime-corpus.json');
await writeFile(corpusPath, `${JSON.stringify(cases, null, 2)}\n`);
const expectedCases = cases.map((entry) => ({
  id: entry.id, declaration: `Ores.Validation.${entry.model}`,
  expectation: entry.valid ? 'accepted' : 'rejected',
}));
const corpusDigest = hash(JSON.stringify(expectedCases));

const sourceAdmission = await import(pathToFileURL(join(sourceRoot, 'validation/tjsv/admission.mjs')).href);
assert.equal(sourceAdmission.VALIDATOR_REVISION, expectedValidator, 'source and runtime TJSV pins disagree');
const runtime = await import(pathToFileURL(join(validatorRoot, 'src/runtime-conformance/index.mjs')).href);

await sourceAdmission.withPublicAdmission({ sourceRoot, validatorRoot }, async (contract) => {
  const tsOut = join(evidenceRoot, 'typescript-zod.json');
  const rustOut = join(evidenceRoot, 'rust-serde.json');
  const dartVmOut = join(evidenceRoot, 'dart-vm.json');
  const dartJsOut = join(evidenceRoot, 'dart-js.json');

  const zodEntry = join(root, 'tmp/zod/node_modules/zod/index.js');
  await run(process.execPath, [join(root, 'runtime-contracts/typescript-adapter.mjs'), corpusPath, tsOut, zodEntry]);

  const rustRun = join(root, 'tmp/rust-runtime');
  await cp(join(root, 'runtime-contracts/rust'), rustRun, { recursive: true });
  const rustVersion = (await run('rustc', ['--version'])).stdout.trim();
  await run('cargo', ['run', '--quiet', '--manifest-path', join(rustRun, 'Cargo.toml'), '--', corpusPath, rustOut], {
    env: { ...process.env, CARGO_TARGET_DIR: join(root, 'tmp/cargo-target'), RUST_RUNTIME: rustVersion },
  });

  await run('dart', ['run', join(root, 'runtime-contracts/dart_adapter.dart'), corpusPath, dartVmOut]);
  const dartVersion = (await run('dart', ['--version'])).stderr.trim() || (await run('dart', ['--version'])).stdout.trim();
  const encodedCorpus = Buffer.from(JSON.stringify(cases), 'utf8').toString('base64');
  const webRunner = join(root, 'tmp/dart_web_runner.dart');
  await writeFile(webRunner, `import 'dart:convert';\nimport '../runtime-contracts/dart_contract.dart';\nvoid main() {\n  final cases = jsonDecode(utf8.decode(base64Decode('${encodedCorpus}'))) as List<dynamic>;\n  final value = evaluateCases(cases, id: 'dart-js-contract', runtime: 'dart2js@3.13.3+node@${process.versions.node}', validator: 'contract-derived-dart/v1', toolchain: 'dart2js@3.13.3');\n  print(jsonEncode(value));\n}\n`);
  const dartJs = join(root, 'tmp/dart-runtime.js');
  await run('dart', ['compile', 'js', webRunner, '-o', dartJs]);
  const compiled = await run('node', ['-e', 'globalThis.self=globalThis; require(process.argv[1]);', dartJs]);
  const jsEvidence = JSON.parse(compiled.stdout.trim().split('\n').at(-1));
  await writeFile(dartJsOut, `${JSON.stringify(jsEvidence, null, 2)}\n`);

  const adapters = await Promise.all([tsOut, rustOut, dartVmOut, dartJsOut]
    .map(async (path) => JSON.parse(await readFile(path, 'utf8'))));
  const runtimeEvidence = {
    schema: runtime.RUNTIME_EVIDENCE_SCHEMA,
    contractIrId: contract.contractIr.irId,
    inputDigest: contract.report.runId,
    corpusDigest,
    adapters,
  };
  const evidencePath = join(evidenceRoot, 'runtime-evidence.json');
  await writeFile(evidencePath, `${JSON.stringify(runtimeEvidence, null, 2)}\n`);

  const requiredAdapters = [
    { id: 'typescript-zod', language: 'typescript', validator: 'zod@4.5.4' },
    { id: 'rust-serde', language: 'rust', validator: 'serde@1.0.228+serde_json@1.0.145' },
    { id: 'dart-vm-contract', language: 'dart', validator: 'contract-derived-dart/v1' },
    { id: 'dart-js-contract', language: 'dart', validator: 'contract-derived-dart/v1' },
  ];
  const admissionOptions = {
    contractIr: contract.contractIr,
    parityReport: contract.report,
    typespec: contract.paths.typespec,
    generatedSchema: contract.paths.generatedSchema,
    authoredSchema: contract.paths.authoredSchema,
    expectedCorpusDigest: corpusDigest,
    expectedCases,
    requiredAdapters,
  };
  const admit = (evidence) => runtime.verifyRuntimeEvidenceAgainstCurrentInputs({
    ...admissionOptions, evidence,
  });
  const positive = await admit(runtimeEvidence);
  assert.equal(positive.status, 'passed', JSON.stringify(positive.findings));
  assert.equal(positive.findingCount, 0);
  assert.equal(positive.summary.passedAdapters, 4);
  await writeFile(join(evidenceRoot, 'runtime-conformance.json'), `${JSON.stringify(positive, null, 2)}\n`);

  const stopped = async (name, mutated, expectedRuleIds = []) => {
    const report = await admit(mutated);
    assert.equal(report.status, 'stopped_for_evaluation', `${name} did not fail closed`);
    assert.ok(report.findingCount > 0, `${name} stopped without findings`);
    const rules = [...new Set(report.findings.map((f) => f.ruleId))].sort();
    for (const ruleId of expectedRuleIds) {
      assert.ok(rules.includes(ruleId), `${name} did not report ${ruleId}: ${rules.join(', ')}`);
    }
    return { name, findingCount: report.findingCount, rules };
  };
  const negative = [];

  const flipped = clone(runtimeEvidence);
  flipped.adapters[0].results[0].verdict = flipped.adapters[0].results[0].verdict === 'accepted' ? 'rejected' : 'accepted';
  negative.push(await stopped('flipped-verdict', flipped,
    ['runtime-adapter-verdict-divergence', 'runtime-case-verdict-mismatch']));

  const missingAdapter = clone(runtimeEvidence);
  missingAdapter.adapters.pop();
  negative.push(await stopped('missing-adapter', missingAdapter, ['runtime-required-adapter-missing']));

  const staleIr = clone(runtimeEvidence);
  staleIr.contractIrId = '0'.repeat(64);
  negative.push(await stopped('stale-ir', staleIr, ['runtime-contract-ir-id-mismatch']));

  const wrongInput = clone(runtimeEvidence);
  wrongInput.inputDigest = '1'.repeat(64);
  negative.push(await stopped('wrong-input-digest', wrongInput, ['runtime-input-digest-mismatch']));

  const wrongCorpus = clone(runtimeEvidence);
  wrongCorpus.corpusDigest = 'f'.repeat(64);
  negative.push(await stopped('wrong-corpus', wrongCorpus, ['runtime-corpus-digest-mismatch']));

  const duplicateCase = clone(runtimeEvidence);
  duplicateCase.adapters[1].results.push(clone(duplicateCase.adapters[1].results[0]));
  negative.push(await stopped('duplicate-case', duplicateCase, ['runtime-result-duplicate']));

  const failedAdapter = clone(runtimeEvidence);
  failedAdapter.adapters[2].status = 'failed';
  negative.push(await stopped('failed-adapter', failedAdapter, ['runtime-adapter-failed']));

  const skippedAdapter = clone(runtimeEvidence);
  skippedAdapter.adapters[3].status = 'skipped';
  negative.push(await stopped('skipped-adapter', skippedAdapter, ['runtime-adapter-not-executed']));

  const duplicateAdapter = clone(runtimeEvidence);
  duplicateAdapter.adapters.push(clone(duplicateAdapter.adapters[0]));
  negative.push(await stopped('duplicate-adapter', duplicateAdapter, ['runtime-adapter-duplicate']));

  const wrongLanguage = clone(runtimeEvidence);
  wrongLanguage.adapters[0].language = 'javascript';
  negative.push(await stopped('wrong-adapter-language', wrongLanguage,
    ['runtime-required-adapter-identity-mismatch']));

  const wrongValidator = clone(runtimeEvidence);
  wrongValidator.adapters[0].validator = 'zod@4.5.5';
  negative.push(await stopped('wrong-adapter-validator', wrongValidator,
    ['runtime-required-adapter-identity-mismatch']));

  const missingCase = clone(runtimeEvidence);
  missingCase.adapters[0].results.shift();
  negative.push(await stopped('missing-case', missingCase, ['runtime-case-missing']));

  const extraCase = clone(runtimeEvidence);
  extraCase.adapters[0].results.push({
    caseId: 'request.synthetic-extra', declaration: 'Ores.Validation.RequestMeta', verdict: 'rejected',
  });
  negative.push(await stopped('extra-case', extraCase, ['runtime-case-extra']));

  const wrongDeclaration = clone(runtimeEvidence);
  wrongDeclaration.adapters[0].results[0].declaration = 'Ores.Validation.PageQuery';
  negative.push(await stopped('wrong-case-declaration', wrongDeclaration,
    ['runtime-case-declaration-mismatch']));

  const erroredCase = clone(runtimeEvidence);
  erroredCase.adapters[0].results[0].verdict = 'error';
  negative.push(await stopped('errored-case', erroredCase, ['runtime-case-error']));

  const skippedCase = clone(runtimeEvidence);
  skippedCase.adapters[0].results[0].verdict = 'skipped';
  negative.push(await stopped('skipped-case', skippedCase, ['runtime-case-not-executed']));

  const unsupportedCase = clone(runtimeEvidence);
  unsupportedCase.adapters[0].results[0].verdict = 'unsupported';
  negative.push(await stopped('unsupported-case', unsupportedCase, ['runtime-case-not-executed']));

  const wrongEvidenceSchema = clone(runtimeEvidence);
  wrongEvidenceSchema.schema = 'ores.typespec-json-schema-validator.runtime-evidence/v0';
  negative.push(await stopped('wrong-evidence-schema', wrongEvidenceSchema,
    ['runtime-evidence-schema-mismatch']));

  const invalidDigest = clone(runtimeEvidence);
  invalidDigest.contractIrId = 'A'.repeat(64);
  negative.push(await stopped('invalid-contract-ir-digest', invalidDigest,
    ['runtime-evidence-invalid-digest']));

  const extraEnvelopeField = clone(runtimeEvidence);
  extraEnvelopeField.unexpected = 'must-not-be-admitted';
  negative.push(await stopped('unexpected-evidence-field', extraEnvelopeField,
    ['runtime-evidence-fields-invalid']));

  const emptyAdapters = clone(runtimeEvidence);
  emptyAdapters.adapters = [];
  negative.push(await stopped('empty-adapter-set', emptyAdapters,
    ['runtime-evidence-adapters-empty', 'runtime-required-adapter-missing']));

  const authoredPath = contract.paths.authoredSchema;
  const originalAuthored = await readFile(authoredPath, 'utf8');
  try {
    const changed = JSON.parse(originalAuthored);
    changed.$defs.PageQuery.properties.limit.maximum = 99;
    await writeFile(authoredPath, `${JSON.stringify(changed, null, 2)}\n`);
    negative.push(await stopped('current-authored-schema-drift', runtimeEvidence));
  } finally {
    await writeFile(authoredPath, originalAuthored);
  }
  const recovered = await admit(runtimeEvidence);
  assert.equal(recovered.status, 'passed', 'positive evidence did not recover after source restoration');

  const summary = {
    schema: 'ores.test.runtime-contract-conformance/v1', status: 'passed',
    sourceCommit: expectedSource, validatorCommit: expectedValidator,
    runtimeCases: cases.length, adapters: requiredAdapters,
    contractIrId: contract.contractIr.irId, parityRunId: contract.report.runId,
    corpusDigest, negativeChecks: negative,
    dartToolchain: dartVersion,
    scope: 'TJSV-bound Zod, Serde and Dart verdict parity, boundary corpus, no-transform assertions, and runtime-evidence tamper refusal',
  };
  await writeFile(join(evidenceRoot, 'summary.json'), `${JSON.stringify(summary, null, 2)}\n`);
});

await run('git', ['-C', sourceRoot, 'diff', '--exit-code', 'HEAD']);
await run('git', ['-C', validatorRoot, 'diff', '--exit-code', 'HEAD']);
console.log('TJSV runtime conformance passed');
