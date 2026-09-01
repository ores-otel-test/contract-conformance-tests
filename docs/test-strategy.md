# Deep test strategy

## Scope

Suite: `contract`
Test organization: `ores-otel-test`
Primary organization: `ores-otel`

## Invariants

- every randomized test uses an explicit deterministic seed;
- retries, duplicates, migrations, and rejected inputs are observable assertions, not sleeps;
- test data is synthetic and contains no production credentials or customer payloads;
- the suite runs without network access by default;
- a product adapter must preserve the reference model and publish the seed and minimized trace on failure;
- scheduled CI is defense in depth; pull-request and main-branch checks remain authoritative.

## Cross-repository compiler oracle

The retry-contract test consumes `ores-otel/ores-interfaces` only at the commit in `rpc-retry/source-lock.json`. The lock content-hashes the TypeSpec source, exact package lock, reviewed compatibility fixtures, boundary instances, and committed generated files. The workflow must repeat the same full commit SHA; repository validation fails closed if the two pins differ.

Network access is limited to CI checkout and exact dependency installation. Compiler execution and all semantic checks run against local immutable inputs. The test repository owns its parser, schema normalizer, expected Protobuf field map, determinism checks, and rejection assertions, so upstream test logic is not trusted to certify itself.

This proves deterministic TypeSpec projection, reviewed JSON Schema equivalence, Protobuf tag/type/presence equivalence, Buf structural validity, deterministic descriptors, and selected boundary behavior at one exact source commit. It does not prove generated SDK behavior, native wire-codec interoperability, network transport, runtime retry execution, or future source commits.

## Expansion path

1. Add generated SDK and native codec adapters for the pinned retry contract.
2. Run the same boundary corpus through each supported runtime.
3. Add transport-level interop without broadening the retry planner into an RPC service.
4. Retain failing seeds and minimized payloads as regression tests.
5. Link behavior changes to the matching Linear issue and repository PR.
