#!/usr/bin/env node

import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import {
  lstatSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  writeFileSync,
} from 'node:fs';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { basename, dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const repositoryRoot = fileURLToPath(new URL('../', import.meta.url));
const sourceRoot = resolve(process.env.ORES_INTERFACES_ROOT ?? 'upstream/ores-interfaces');
const contractRoot = join(sourceRoot, 'contracts/rpc-retry/v1');
const lock = readJson(join(repositoryRoot, 'rpc-retry/source-lock.json'));
const generatedFiles = [
  'json-schema/RetryAttempt.json',
  'json-schema/RetryDecision.json',
  'json-schema/RetryInput.json',
  'json-schema/RetryPolicy.json',
  'protobuf/ores/rpc/v1.proto',
];

function readJson(path) {
  return JSON.parse(readFileSync(path, 'utf8'));
}

function run(label, command, args, cwd = repositoryRoot) {
  const completed = spawnSync(command, args, {
    cwd,
    encoding: 'utf8',
    env: { ...process.env, NO_COLOR: '1' },
  });
  assert.equal(
    completed.status,
    0,
    `${label} failed\nstdout:\n${completed.stdout}\nstderr:\n${completed.stderr}`,
  );
  return completed.stdout.trim();
}

function executable(name) {
  return join(
    contractRoot,
    'node_modules',
    '.bin',
    process.platform === 'win32' ? `${name}.cmd` : name,
  );
}

function sha256(path) {
  return createHash('sha256').update(readFileSync(path)).digest('hex');
}

function regularFiles(root, current = root) {
  return readdirSync(current, { withFileTypes: true }).flatMap((entry) => {
    const path = join(current, entry.name);
    const stat = lstatSync(path);
    assert.equal(stat.isSymbolicLink(), false, `generated output is a symlink: ${path}`);
    if (stat.isDirectory()) return regularFiles(root, path);
    assert.equal(stat.isFile(), true, `generated output is not a regular file: ${path}`);
    return [relative(root, path)];
  }).sort();
}

function compile(label) {
  const temporaryRoot = mkdtempSync(join(tmpdir(), `ores-test-rpc-${label}-`));
  const output = join(temporaryRoot, 'generated');
  run(
    `TypeSpec ${label}`,
    executable('tsp'),
    ['compile', '.', '--warn-as-error', '--output-dir', output],
    contractRoot,
  );
  return { output, temporaryRoot };
}

function writeIndependentBufConfig(temporaryRoot) {
  writeFileSync(join(temporaryRoot, 'buf.yaml'), `version: v2
modules:
  - path: generated/protobuf
lint:
  use:
    - STANDARD
  except:
    - PACKAGE_DIRECTORY_MATCH
`);
}

function parseProto(source) {
  const packageMatch = source.match(/^package\s+([A-Za-z0-9_.]+);/m);
  assert.ok(packageMatch, 'Protobuf package declaration is required');
  const messages = {};
  for (const match of source.matchAll(/message\s+(\w+)\s*\{([^}]*)\}/g)) {
    const fields = [];
    for (const field of match[2].matchAll(/^\s*(optional\s+)?([A-Za-z0-9_.]+)\s+(\w+)\s*=\s*(\d+)\s*;/gm)) {
      fields.push({
        name: field[3],
        type: field[2],
        tag: Number(field[4]),
        optional: Boolean(field[1]),
      });
    }
    messages[match[1]] = fields;
  }
  return { package: packageMatch[1], messages };
}

function normalizeSchema(schema) {
  const properties = Object.fromEntries(Object.entries(schema.properties).map(([name, value]) => {
    if ('$ref' in value) {
      return [name, { ref: basename(value.$ref).replace(/\.json$/, '').replace(/^#\/\$defs\//, '') }];
    }
    return [name, Object.fromEntries(
      ['type', 'minimum', 'maximum']
        .filter((key) => key in value)
        .map((key) => [key, value[key]]),
    )];
  }));
  const closed = schema.additionalProperties === false
    || JSON.stringify(schema.unevaluatedProperties) === JSON.stringify({ not: {} });
  return {
    type: schema.type,
    properties,
    required: [...schema.required].sort(),
    closed,
  };
}

assert.equal(
  run('resolve source commit', 'git', ['rev-parse', 'HEAD'], sourceRoot),
  lock.commit,
  'the source checkout is not the exact reviewed commit',
);

for (const [path, expectedHash] of Object.entries(lock.files)) {
  const absolute = join(sourceRoot, path);
  const stat = lstatSync(absolute);
  assert.equal(stat.isFile(), true, `${path} must be a regular file`);
  assert.equal(stat.isSymbolicLink(), false, `${path} must not be a symlink`);
  assert.ok(stat.size <= 1_000_000, `${path} unexpectedly exceeds 1 MB`);
  assert.equal(sha256(absolute), expectedHash, `${path} differs from the reviewed source lock`);
}

const packageJson = readJson(join(contractRoot, 'package.json'));
assert.deepEqual(packageJson.devDependencies, {
  '@bufbuild/buf': '1.72.0',
  '@typespec/compiler': '1.15.0',
  '@typespec/json-schema': '1.15.0',
  '@typespec/protobuf': '0.85.0',
  ajv: '8.20.0',
});

const first = compile('first');
const second = compile('second');
const committed = join(contractRoot, 'generated');
assert.deepEqual(regularFiles(first.output), generatedFiles);
assert.deepEqual(regularFiles(second.output), generatedFiles);
assert.deepEqual(regularFiles(committed), generatedFiles);
for (const path of generatedFiles) {
  const one = readFileSync(join(first.output, path));
  const two = readFileSync(join(second.output, path));
  const reviewed = readFileSync(join(committed, path));
  assert.deepEqual(one, two, `${path} is nondeterministic across clean compiler outputs`);
  assert.deepEqual(one, reviewed, `${path} is stale relative to TypeSpec`);
}

for (const result of [first, second]) {
  writeIndependentBufConfig(result.temporaryRoot);
  run(
    `Buf lint ${basename(result.temporaryRoot)}`,
    executable('buf'),
    ['lint', '--config', 'buf.yaml'],
    result.temporaryRoot,
  );
  run(
    `Buf descriptor ${basename(result.temporaryRoot)}`,
    executable('buf'),
    [
      'build',
      '--config',
      'buf.yaml',
      '--as-file-descriptor-set',
      '-o',
      join(result.temporaryRoot, 'retry-descriptor.binpb'),
    ],
    result.temporaryRoot,
  );
}
assert.deepEqual(
  readFileSync(join(first.temporaryRoot, 'retry-descriptor.binpb')),
  readFileSync(join(second.temporaryRoot, 'retry-descriptor.binpb')),
  'Buf descriptor set is nondeterministic',
);

const expectedProto = {
  package: 'ores.rpc.v1',
  messages: {
    RetryPolicy: [
      { name: 'max_attempts', type: 'uint32', tag: 1, optional: false },
      { name: 'timeout_ms', type: 'uint32', tag: 2, optional: false },
      { name: 'initial_backoff_ms', type: 'uint32', tag: 3, optional: false },
      { name: 'max_backoff_ms', type: 'uint32', tag: 4, optional: false },
    ],
    RetryAttempt: [
      { name: 'attempts_completed', type: 'uint32', tag: 1, optional: false },
      { name: 'elapsed_ms', type: 'uint32', tag: 2, optional: false },
      { name: 'code', type: 'uint32', tag: 3, optional: false },
      { name: 'cancelled', type: 'bool', tag: 4, optional: false },
      { name: 'replay_safe', type: 'bool', tag: 5, optional: false },
      { name: 'jitter_permille', type: 'uint32', tag: 6, optional: false },
      { name: 'retry_after_ms', type: 'uint32', tag: 7, optional: true },
    ],
    RetryInput: [
      { name: 'policy', type: 'RetryPolicy', tag: 1, optional: false },
      { name: 'attempt', type: 'RetryAttempt', tag: 2, optional: false },
    ],
    RetryDecision: [
      { name: 'retry', type: 'bool', tag: 1, optional: false },
      { name: 'delay_ms', type: 'uint32', tag: 2, optional: false },
      { name: 'reason', type: 'uint32', tag: 3, optional: false },
    ],
  },
};
const emittedProto = parseProto(readFileSync(join(committed, 'protobuf/ores/rpc/v1.proto'), 'utf8'));
const reviewedProto = parseProto(readFileSync(join(contractRoot, 'expected/retry.proto'), 'utf8'));
assert.deepEqual(emittedProto, expectedProto, 'emitted Protobuf field contract drifted');
assert.deepEqual(reviewedProto, expectedProto, 'reviewed Protobuf oracle drifted');

const reviewedSchema = readJson(join(contractRoot, 'expected/schema.json'));
for (const name of ['RetryPolicy', 'RetryAttempt', 'RetryInput', 'RetryDecision']) {
  const emitted = readJson(join(committed, `json-schema/${name}.json`));
  assert.equal(emitted.$schema, 'https://json-schema.org/draft/2020-12/schema');
  assert.deepEqual(
    normalizeSchema(emitted),
    normalizeSchema(reviewedSchema.$defs[name]),
    `${name} emitted and independently reviewed schema semantics differ`,
  );
}

const contractRequire = createRequire(join(contractRoot, 'package.json'));
const Ajv2020 = contractRequire('ajv/dist/2020').default;
const ajv = new Ajv2020({ allErrors: true, strict: true });
for (const name of ['RetryPolicy', 'RetryAttempt', 'RetryInput', 'RetryDecision']) {
  ajv.addSchema(readJson(join(committed, `json-schema/${name}.json`)));
}
const instances = readJson(join(contractRoot, 'instances.json'));
for (const [name, cases] of Object.entries(instances)) {
  const validate = ajv.getSchema(`${name}.json`);
  assert.ok(validate, `compiled validator missing for ${name}`);
  for (const value of cases.valid) {
    assert.equal(validate(value), true, `${name} rejected a reviewed valid boundary instance`);
  }
  for (const fixture of cases.invalid) {
    assert.equal(validate(fixture.value), false, `${name} accepted invalid case: ${fixture.name}`);
  }
}

const exposedFieldNames = Object.values(emittedProto.messages).flat().map((field) => field.name);
for (const forbidden of ['credential', 'password', 'secret', 'token']) {
  assert.equal(exposedFieldNames.includes(forbidden), false, `forbidden wire field exposed: ${forbidden}`);
}

console.log(`verified TypeSpec/Protobuf retry contract at ${lock.commit}`);
