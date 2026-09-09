# External shared-runtime validation — DEN-3958

These are external-consumer tests of `ores-otel/ores-lib-core` PR #23, not copied
implementations, not a JSON-only model, and not a deployment or package release.
All runtime code is imported/compiled from the pinned upstream checkout.

The independent synthetic corpus has 3,504 cases: all ASCII insertion values,
correlation length boundaries, email local/domain limits, normalization output,
and deterministic non-ASCII samples across Unicode planes. Rust, TypeScript,
Dart VM and compiled Dart JavaScript replay those same expectations. Each runtime
also tests all 256 byte values in all 32 digest positions (8,192 combinations).
Dart additionally rejects 384 out-of-range value/position/argument placements.
A negative Rust compilation proves a non-byte array cannot enter its API.

The original upstream commit is a positive control for the known Unicode/Dart
byte-validation defects: tests must reproduce those defects there and reject
those inputs in the candidate. This prevents an unrelated exception or an empty
suite from being reported as the fix working. Source checkouts stay unmodified.

Run from this repository after the two pinned checkouts exist at `tmp/core` and
`tmp/baseline`: `bash validation/run.sh`. CI restricts execution to `*-test`
organization owners, uses read-only permissions and retains per-runtime output,
corpus digests, source IDs and actual toolchain versions. Other test organizations
may checkout this harness at an immutable commit and execute it against the same
source pins. No secrets, deployment credentials or production data are needed.

This is finite runtime regression evidence, not a proof of complete equivalence.
The Rust library here has no Serde request decoder, and the TypeScript library
uses native JavaScript checks rather than Zod; no Zod/Serde fleet coverage is
claimed. Dart2js is executed in Node, not a browser. TJSV contract approval and
registry-backed Zed frozen installations remain separate acceptance gates.
