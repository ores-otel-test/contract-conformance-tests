# TJSV runtime conformance across Zod, Serde and Dart — DEN-3958

This test-org lane closes a gap left explicit by the earlier `validation/` suite:
it executes real runtime validators and then asks
`ORESoftware/typespec-json-schema-validator` to make the cross-runtime admission
decision. TypeSpec and independently authored Draft 2020-12 JSON Schema remain
the peer authorities; runtime receipts are downstream execution evidence only.

Pinned inputs:

- `ores-otel/ores-interfaces@acfb017bc624471767862866d62c1088ffb43c59`
- `ORESoftware/typespec-json-schema-validator@2281843126ab644607b11cf8281d84f382d68dfc`
- Zod `4.5.4`
- Serde `1.0.228` + serde_json `1.0.145`
- Dart SDK `3.13.3`

The matrix covers JSON Schema integer semantics (`18`, `18.0`, `1.8e1` versus
fractions/strings), exact unknown-field rejection, missing versus explicit null,
Unicode code-point length boundaries with supplementary-plane emoji and combining
marks, oneOf behavior and no implicit trimming/default insertion. Rust does not
map JSON Schema `integer` directly to a language representation: its custom Serde
deserializer deliberately accepts numerically integral JSON numbers such as
`18.0` while rejecting `18.5` and strings. Optional non-null fields use a custom
Serde deserializer so `missing` and `null` are not collapsed into the same
`Option::None`. String limits count `chars()`, not UTF-8 bytes.

The TypeScript adapter uses strict Zod objects and a contract-derived code-point
string helper rather than assuming a library default has JSON Schema length
semantics. Dart uses the same explicit JSON-number and `runes.length` policy in
both VM and dart2js execution. Every accepted adapter result must preserve the
input semantically: no trim, normalization, default insertion or key dropping.

After all adapters execute, `verifyRuntimeEvidenceAgainstCurrentInputs()` binds
the evidence to the freshly verified Contract IR, parity receipt run ID, current
TypeSpec/generated/authored source inputs and trusted runtime corpus digest. The
suite also requires TJSV to stop evaluation for a flipped verdict, missing
adapter, stale IR id, wrong corpus digest, duplicate case, failed adapter and a
temporarily drifted authored schema. The drifted source is restored and a final
positive admission must recover before CI can pass.

This remains finite regression evidence. It does not certify every Zod/Serde
usage in the fleet, every custom predicate, browser UI behavior, authorization,
database invariants, or transformations outside these contracts. The test never
copies TJSV or turns runtime code into another editable schema authority.
