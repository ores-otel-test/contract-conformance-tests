import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';

const runtimeRoot = process.env.ORES_OTEL_RUNTIME;
assert.ok(runtimeRoot, 'ORES_OTEL_RUNTIME is required');

const api = await import(pathToFileURL(join(runtimeRoot, 'dist/config.js')).href);
const { parseOresOtelToml, resolveOresOtelConfig, resolveOresOtelExporterEndpoint } = api;
const source = await readFile('otel-peer-authority/.ores-otel.toml', 'utf8');
const expectedInstance = JSON.parse(
  await readFile('otel-peer-authority/instances/OtelPolicyCanary/valid/repository.json', 'utf8'),
);
const parsed = parseOresOtelToml(source);
assert.deepEqual(parsed, expectedInstance, 'canonical runtime parse must equal the admitted JSON instance');

const resolved = resolveOresOtelConfig(parsed, { role: 'server', env: {} });
assert.equal(resolved.role, 'server');
assert.equal(resolved.serviceName, 'otel-peer-canary');
assert.equal(resolved.tracing.sampleRatio, 0.25);
assert.deepEqual(resolved.tracing.propagators, ['tracecontext', 'baggage']);
assert.equal(resolved.exporter.protocol, 'otlp_http');
assert.equal(resolved.exporter.endpointEnv, 'OTEL_CANARY_ENDPOINT');
assert.equal(resolveOresOtelExporterEndpoint(resolved, {}), undefined);
assert.equal(
  resolveOresOtelExporterEndpoint(resolved, { OTEL_CANARY_ENDPOINT: 'https://collector.test.invalid' }),
  'https://collector.test.invalid',
);
assert.ok(!source.includes('https://collector.test.invalid'), 'endpoint value must remain runtime-only');

const mixed = `${source}\n[client]\nservice_name = "otel-peer-client"\n`;
assert.throws(
  () => resolveOresOtelConfig(parseOresOtelToml(mixed), { env: {} }),
  /both client and server sections exist/u,
);

console.log(JSON.stringify({
  parsedMatchesAdmittedInstance: true,
  role: resolved.role,
  serviceName: resolved.serviceName,
  sampleRatio: resolved.tracing.sampleRatio,
  exporterProtocol: resolved.exporter.protocol,
  endpointSource: resolved.exporter.endpointEnv,
}));
