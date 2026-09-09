# TJSV runtime conformance across Zod, Serde and Dart — DEN-3958 / DEN-3959

This test-org lane closes a gap left explicit by the earlier `validation/` suite:
it executes real runtime validators and then asks
`ORESoftware/typespec-json-schema-validator` to make the cross-runtime admission
decision. TypeSpec and independently authored Draft 2020-12 JSON Schema remain
the peer authorities; runtime receipts are downstream execution evidence only.

Current recertification pins:

- `ores-otel/ores-interfaces@09b06c7d82852b657e812a70eeb63023d0aed2a6`
- `ORESoftware/typespec-json-schema-validator@d60d0d79d83e075077382623ec9e23a401ab601f`
- Zod `4.5.4`
- Serde `1.0.228` + serde_json `1.0.145`
- Dart SDK `3.13.3`

The 65-case matrix covers JSON Schema integer semantics (`18`, `18.0`,
`1.8e1`, `1e2` versus fractions, strings, booleans, negative and out-of-range
numbers), exact unknown-field rejection, missing versus explicit null, Unicode
code-point length boundaries with supplementary-plane emoji and combining marks,
oneOf behavior, scalar rejection at union boundaries, and no implicit
trimming/default insertion. It now exercises every declared string ceiling in
this canary, including 4,096-code-point problem details and both request/trace
identifier boundaries.

Rust does not map JSON Schema `integer` directly to a language representation:
its custom Serde deserializer deliberately accepts numerically integral JSON
numbers such as `18.0` while rejecting `18.5` and strings. Optional non-null
fields use a custom Serde deserializer so `missing` and `null` are not collapsed
into the same `Option::None`. String limits count `chars()`, not UTF-8 bytes.

The TypeScript adapter uses strict Zod objects and a contract-derived code-point
string helper rather than assuming a library default has JSON Schema length
semantics. Dart uses the same explicit JSON-number and `runes.length` policy in
both VM and dart2js execution. Every accepted adapter result must preserve the
input semantically: no trim, normalization, default insertion or key dropping.

After all adapters execute, `verifyRuntimeEvidenceAgainstCurrentInputs()` binds
the evidence to the freshly verified Contract IR, parity receipt run ID, current
TypeSpec/generated/authored source inputs and trusted runtime corpus digest. The
suite requires TJSV to stop evaluation for 22 independent tamper/refusal probes,
including:

- verdict divergence, missing/extra/duplicate cases, wrong declaration identity,
  and `error`/`skipped`/`unsupported` case outcomes;
- missing, failed, skipped, duplicated, wrong-language and wrong-validator
  adapters;
- stale Contract IR, wrong parity input digest, wrong corpus digest, malformed
  digest syntax, wrong evidence schema and unexpected envelope fields;
- an empty adapter set; and
- a temporarily drifted current authored schema.

Each stable refusal probe asserts the specific TJSV rule class rather than only
checking for a generic nonzero finding count. The authored-schema drift is then
restored and the original positive evidence must recover before CI can pass.
This verifies that fail-closed admission is both sensitive to current authority
bytes and reversible after the trusted source is restored.

The earlier DEN-3958 run remains historical evidence against the prior reviewed
TJSV/source pair. DEN-3959 advanced immutable source and validator pins to the
pair used by the central `ORESoftware/ores-interfaces` consumer; later test-only
slices expand the independently maintained runtime corpus and refusal matrix
without changing those authority/tool pins. This separation makes runtime or
admission drift visible instead of changing producer, consumer and tests at once.

This remains finite regression evidence. It does not certify every Zod/Serde
usage in the fleet, every custom predicate, browser UI behavior, authorization,
database invariants, or transformations outside these contracts. The test never
copies TJSV or turns runtime code into another editable schema authority.
