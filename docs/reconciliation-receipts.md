# ORESC reconciliation receipt safety

`deep_tests.reconciliation_receipts` is an independent, content-free safety
oracle for receipts emitted by the selected-organization `oresc` reconciliation
workflow. Receipts may name organizations, repositories, command classes,
policy findings, exit codes, and private receipt paths. They must not retain
credential values, authenticated URLs, private-key material, JWTs, prompts,
answers, message bodies, document/signature contents, or cache values.

The scanner is bounded to 1 MiB by default and validates bytes as strict UTF-8.
Its result contains only a schema identifier, acceptance state, byte count, and
stable finding codes. It never returns the matched value or surrounding text.

This suite does not make a receipt authoritative evidence that a repository was
created, that a live probe passed, or that a production/test integration is
ready. It only verifies the redaction boundary. Exact GitHub state remains the
responsibility of authenticated, read-only inventory and explicit creation
receipts.
