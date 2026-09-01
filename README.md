# ores-otel-test/contract-conformance-tests

Deterministic state-model, idempotency, serialization, and protocol contract conformance tests.

This repository is the `contract` deep-test suite for `ores-otel`. It is intentionally dependency-light and deterministic so failures can be reproduced locally without production credentials or customer data.

## Run

```bash
PYTHONPATH=src python -m unittest discover -s tests -v
python scripts/verify_repository.py
```

The initial model is executable rather than a placeholder. Product adapters should be added through focused pull requests while preserving the reference-model tests as an oracle.

## TypeSpec and Protobuf cross-check

`rpc-retry/source-lock.json` pins the exact `ores-otel/ores-interfaces` commit and every consumed contract artifact by SHA-256. CI checks out that immutable commit, installs its exact lockfile with lifecycle scripts disabled, and runs `scripts/verify_rpc_retry_contract.mjs` as an external oracle.

The oracle independently:

- compiles the TypeSpec contract twice and requires byte-identical JSON Schema and Protobuf output;
- requires the generated output to match the reviewed, committed artifacts;
- parses the Protobuf package, messages, field types, field numbers, and proto3 optional presence;
- normalizes emitted and manually reviewed JSON Schema semantics before comparing them;
- builds the schema twice with Buf and requires deterministic descriptor sets; and
- accepts reviewed boundary values while rejecting unknown properties, null optional scalars, and out-of-range values.

To run the external oracle locally, install the pinned source toolchain first and point the test at an exact checkout:

```bash
cd /path/to/ores-interfaces/contracts/rpc-retry/v1
npm ci --ignore-scripts
cd /path/to/contract-conformance-tests
ORES_INTERFACES_ROOT=/path/to/ores-interfaces node scripts/verify_rpc_retry_contract.mjs
```

The current retry-planner slice is a DTO and local decision contract, not an HTTP service surface. It therefore cross-checks TypeSpec's JSON Schema and Protobuf projections without inventing an empty OpenAPI API. OpenAPI belongs in this matrix when an actual versioned HTTP operation is modeled.

Tracking: https://github.com/ORESoftware/ai-agent-coordinator.rs/issues/139
