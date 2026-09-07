# Shared-stack telemetry redaction contract

This suite models the final boundary between request middleware, authentication, rate limiting, Redis-backed denial state, and OTel exporters.

## Producer contract

Trusted producers construct a `SharedStackContext` with pre-derived identifiers only. Tenant and principal fields use keyed-HMAC-shaped identifiers; this test model intentionally does not accept or hash raw identities. Trace and span identifiers use their fixed-width lower-case hexadecimal wire forms. Route, realm, rate-policy, rate-decision, cache revision, and cache source are bounded enumerations or identifiers.

The strict producer API rejects unknown attributes. The untrusted-extension API drops unknown, sensitive, malformed, and high-cardinality attributes and reports only a count. It never echoes a rejected key or value.

## Forbidden material

Export records and test receipts must not contain authorization headers, cookies, tokens, credentials, private keys, connection strings, database locations, session or claim bodies, prompts or answers, message contents, documents, signatures or initials, emails, phone numbers, addresses, raw client identity, rate-limit keys, cache keys, or cache values.

The model permits only bounded operational fields such as service name, deployment environment, HTTP method/status, RPC system, retry attempt, Redis operation/outcome, and error type. Receipts contain attribute names and counts—not attribute values or trace identifiers.

## Cross-component invariants

- `ores-middleware` authenticates and resolves the trust realm before a rate-limit decision is attached.
- `ores-rate-limit` exports policy and decision metadata, never the opaque state key itself.
- `ores-redis-lru-cache` exports revision/source metadata, never a cache key or value. A `local-denial` source is valid only with a deny decision.
- `ores-otel` validates the final record again before exporter delivery.
- A `not_checked` rate decision requires cache source `none`; this prevents an unauthenticated request from appearing to have consulted Redis or a local cache.

These deterministic tests are conformance evidence, not proof that every deployed service has adopted the contract. Production acceptance requires language-specific consumer tests and redacted exporter evidence against exact revisions.
