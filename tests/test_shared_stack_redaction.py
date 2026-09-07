"""Deterministic security tests for the shared-stack OTel boundary."""

from __future__ import annotations

from dataclasses import replace
import json
import unittest

from deep_tests.redaction_model import (
    CORE_ATTRIBUTE_KEYS,
    SharedStackContext,
    TelemetryContractError,
    assert_export_safe,
    build_export_record,
    filter_untrusted_attributes,
)


def context(**changes: object) -> SharedStackContext:
    base = SharedStackContext(
        request_id="req_0123456789abcdef0123456789abcdef",
        trace_id="0123456789abcdef0123456789abcdef",
        span_id="0123456789abcdef",
        tenant_hash="hmac-sha256:" + "a" * 64,
        principal_hash="hmac-sha256:" + "b" * 64,
        route_id="messages.create",
        realm="customer",
        rate_policy="messages.create.customer",
        rate_decision="allow",
        cache_revision=41,
        cache_source="redis",
    )
    return replace(base, **changes)


class SharedStackRedactionTests(unittest.TestCase):
    def test_valid_record_contains_only_bounded_operational_attributes(self) -> None:
        record = build_export_record(
            context(),
            {
                "deployment.environment.name": "production",
                "http.request.method": "POST",
                "http.response.status_code": 200,
                "redis.operation": "eval",
                "redis.outcome": "allow",
                "retry.attempt": 0,
                "rpc.system": "http",
                "service.name": "ores-chat-api-server",
            },
        )
        self.assertTrue(CORE_ATTRIBUTE_KEYS <= set(record.attributes))
        self.assertEqual(list(record.attributes), sorted(record.attributes))
        self.assertNotIn("rate.key", record.attributes)
        self.assertNotIn("cache.value", record.attributes)
        self.assertEqual(record.dropped_attribute_count, 0)

    def test_receipt_never_contains_attribute_values_or_trace_identifiers(self) -> None:
        record = build_export_record(context(), {"service.name": "ores-chat-api-server"})
        receipt = record.receipt()
        serialized = json.dumps(receipt, sort_keys=True)
        self.assertNotIn(context().tenant_hash, serialized)
        self.assertNotIn(context().principal_hash, serialized)
        self.assertNotIn(context().trace_id, serialized)
        self.assertNotIn(context().span_id, serialized)
        self.assertEqual(receipt["attributeKeys"], sorted(record.attributes))

    def test_sensitive_attribute_names_fail_closed_at_trusted_boundary(self) -> None:
        for key in [
            "authorization",
            "http.request.cookie",
            "auth.claim.email",
            "rate.key",
            "cache.value",
            "database.url",
            "prompt.body",
            "document.id",
            "signature.value",
        ]:
            with self.subTest(key=key):
                with self.assertRaises(TelemetryContractError):
                    build_export_record(context(), {key: "redacted"})

    def test_unknown_high_cardinality_attribute_fails_closed(self) -> None:
        with self.assertRaisesRegex(TelemetryContractError, "unknown telemetry attribute"):
            build_export_record(context(), {"user.supplied.dimension": "synthetic"})

    def test_untrusted_extensions_are_dropped_without_echoing_names_or_values(self) -> None:
        record = filter_untrusted_attributes(
            context(),
            {
                "service.name": "ores-chat-api-server",
                "http.request.method": "POST",
                "authorization": "redacted",
                "prompt.body": "redacted",
                "arbitrary.dimension": "redacted",
                "http.response.status_code": 999,
            },
        )
        self.assertEqual(record.dropped_attribute_count, 4)
        self.assertEqual(record.attributes["service.name"], "ores-chat-api-server")
        self.assertEqual(record.attributes["http.request.method"], "POST")
        receipt = json.dumps(record.receipt(), sort_keys=True)
        self.assertNotIn("authorization", receipt)
        self.assertNotIn("prompt.body", receipt)
        self.assertNotIn("arbitrary.dimension", receipt)
        self.assertNotIn("redacted", receipt)

    def test_raw_tenant_and_principal_identifiers_are_rejected(self) -> None:
        for field, value in [
            ("tenant_hash", "tenant-123"),
            ("principal_hash", "person-456"),
        ]:
            with self.subTest(field=field):
                with self.assertRaises(TelemetryContractError):
                    build_export_record(context(**{field: value}))

    def test_trace_and_span_ids_reject_zero_or_wrong_width(self) -> None:
        for changes in [
            {"trace_id": "0" * 32},
            {"span_id": "0" * 16},
            {"trace_id": "abc"},
            {"span_id": "abc"},
        ]:
            with self.subTest(changes=changes):
                with self.assertRaises(TelemetryContractError):
                    build_export_record(context(**changes))

    def test_local_denial_cache_cannot_report_an_allow(self) -> None:
        with self.assertRaisesRegex(TelemetryContractError, "local-denial"):
            build_export_record(context(cache_source="local-denial", rate_decision="allow"))
        denied = build_export_record(context(cache_source="local-denial", rate_decision="deny"))
        self.assertEqual(denied.attributes["rate.decision"], "deny")

    def test_not_checked_rate_decision_requires_no_cache_authority(self) -> None:
        with self.assertRaisesRegex(TelemetryContractError, "not_checked"):
            build_export_record(context(rate_decision="not_checked", cache_source="redis"))
        record = build_export_record(context(rate_decision="not_checked", cache_source="none"))
        self.assertEqual(record.attributes["cache.source"], "none")

    def test_revision_and_status_values_are_strictly_typed(self) -> None:
        for changes in [
            {"cache_revision": -1},
            {"cache_revision": True},
            {"rate_decision": "maybe"},
            {"cache_source": "permit-cache"},
            {"realm": "super-admin"},
        ]:
            with self.subTest(changes=changes):
                with self.assertRaises(TelemetryContractError):
                    build_export_record(context(**changes))

    def test_operational_enums_and_bounds_are_enforced(self) -> None:
        invalid = [
            ("deployment.environment.name", "preview"),
            ("http.request.method", "TRACE"),
            ("http.response.status_code", 99),
            ("http.response.status_code", True),
            ("redis.operation", "dump"),
            ("redis.outcome", "payload"),
            ("retry.attempt", -1),
            ("rpc.system", "custom"),
            ("service.name", "UPPERCASE"),
        ]
        for key, value in invalid:
            with self.subTest(key=key, value=value):
                with self.assertRaises(TelemetryContractError):
                    build_export_record(context(), {key: value})

    def test_sensitive_shaped_values_are_rejected_even_on_allowed_keys(self) -> None:
        for key, value in [
            ("error.type", "Bearer credential"),
            ("error.type", "user@example.invalid"),
        ]:
            with self.subTest(key=key):
                with self.assertRaises(TelemetryContractError):
                    build_export_record(context(), {key: value})

    def test_long_or_multiline_values_do_not_cross_export_boundary(self) -> None:
        for value in ["a" * 129, "SafeError\nInjected"]:
            with self.subTest(value=value[:20]):
                with self.assertRaises(TelemetryContractError):
                    build_export_record(context(), {"error.type": value})

    def test_final_export_requires_every_core_attribute(self) -> None:
        attributes = dict(build_export_record(context()).attributes)
        attributes.pop("tenant.hash")
        with self.assertRaisesRegex(TelemetryContractError, "missing a core attribute"):
            assert_export_safe(context().trace_id, context().span_id, attributes)

    def test_output_is_deterministic_for_different_input_mapping_orders(self) -> None:
        left = build_export_record(
            context(),
            {"service.name": "ores-chat-api-server", "http.request.method": "POST"},
        )
        right = build_export_record(
            context(),
            {"http.request.method": "POST", "service.name": "ores-chat-api-server"},
        )
        self.assertEqual(dict(left.attributes), dict(right.attributes))
        self.assertEqual(left.receipt(), right.receipt())


if __name__ == "__main__":
    unittest.main()
