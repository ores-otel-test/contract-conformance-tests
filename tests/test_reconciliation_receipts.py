from __future__ import annotations

import json
import random
import string
import unittest

from deep_tests.reconciliation_receipts import (
    MAX_RECEIPT_BYTES,
    ReceiptLimitError,
    scan_receipt,
)


class ReconciliationReceiptTests(unittest.TestCase):
    def test_safe_reconciliation_receipt_is_accepted(self) -> None:
        receipt = "\n".join(
            [
                "[ores-fleet] mode: preview",
                "production: ores-rate-limit prefix=ores-rl",
                "test: ores-redis-lru-cache-test",
                "missing: ores-redis-lru-cache-test.github.io",
                "receipts: .ores/reconcile/20260909T001500Z.abcd12",
            ]
        )
        result = scan_receipt(receipt)
        self.assertTrue(result.accepted)
        self.assertEqual(result.finding_codes, ())
        self.assertEqual(result.summary()["status"], "accepted")

    def test_detects_all_supported_secret_classes_without_echoing_values(self) -> None:
        private_header = "-" * 5 + "BEGIN" + " " + "PRIVATE" + " " + "KEY" + "-" * 5
        fixtures = {
            "github-token": "gh" + "p_" + "A" * 24,
            "linear-token": "lin_" + "api_" + "B" * 24,
            "supabase-token": "sb_" + "secret_" + "C" * 24,
            "aws-access-key": "AKIA" + "D" * 16,
            "bearer-token": "Authorization: Bearer " + "E" * 32,
            "jwt": ".".join(["F" * 20, "G" * 20, "H" * 20]),
            "private-key": private_header,
            "database-url-credentials": "postgresql://user:" + "secret" + "@db.invalid/app",
            "secret-env-assignment": "FLEET_READ_TOKEN=" + "I" * 24,
            "sensitive-payload-field": "cache_value=" + "J" * 24,
        }
        for expected, value in fixtures.items():
            with self.subTest(expected=expected):
                result = scan_receipt(value)
                self.assertIn(expected, result.finding_codes)
                serialized = json.dumps(result.summary(), sort_keys=True)
                self.assertNotIn(value, serialized)
                self.assertNotIn(value[-12:], serialized)

    def test_findings_are_deduplicated_and_stably_ordered(self) -> None:
        receipt = "\n".join(
            [
                "gh" + "p_" + "A" * 24,
                "gh" + "p_" + "B" * 24,
                "Authorization: Bearer " + "C" * 24,
                "GITHUB_TOKEN=" + "D" * 24,
            ]
        )
        self.assertEqual(
            scan_receipt(receipt).finding_codes,
            ("github-token", "bearer-token", "secret-env-assignment"),
        )

    def test_short_policy_literals_are_not_values(self) -> None:
        receipt = "forbid github_pat_ and Authorization: Bearer placeholders"
        self.assertTrue(scan_receipt(receipt).accepted)

    def test_invalid_utf8_is_rejected_without_decoded_content(self) -> None:
        result = scan_receipt(b"safe-prefix\xffsecret-suffix")
        self.assertEqual(result.finding_codes, ("invalid-utf8",))
        self.assertNotIn("safe-prefix", json.dumps(result.summary()))

    def test_nul_is_rejected_as_binary_data(self) -> None:
        result = scan_receipt("owner=ores-chat\x00repo=private")
        self.assertEqual(result.finding_codes, ("binary-data",))

    def test_size_is_checked_before_content_processing(self) -> None:
        with self.assertRaises(ReceiptLimitError):
            scan_receipt("x" * (MAX_RECEIPT_BYTES + 1))

    def test_custom_bound_requires_positive_integer(self) -> None:
        for value in (0, -1, True, 1.5):
            with self.subTest(value=value), self.assertRaises(ValueError):
                scan_receipt("safe", max_bytes=value)  # type: ignore[arg-type]

    def test_non_text_input_is_rejected(self) -> None:
        with self.assertRaises(TypeError):
            scan_receipt({"receipt": "safe"})  # type: ignore[arg-type]

    def test_seeded_safe_receipts_remain_accepted(self) -> None:
        alphabet = string.ascii_lowercase + string.digits + "-"
        for seed in range(100):
            rng = random.Random(seed)
            org = "test-" + "".join(rng.choice(alphabet) for _ in range(20)).strip("-")
            repo = "suite-" + "".join(rng.choice(alphabet) for _ in range(30)).strip("-")
            receipt = f"organization={org}\nrepository={repo}\nstatus=missing\nexit=2"
            with self.subTest(seed=seed):
                self.assertTrue(scan_receipt(receipt).accepted)

    def test_summary_schema_is_content_free(self) -> None:
        secret = "ORES_CLI_READ_TOKEN=" + "Z" * 32
        summary = scan_receipt(secret).summary()
        self.assertEqual(summary["schemaVersion"], "oresc.reconciliation-receipt-scan.v1")
        self.assertEqual(summary["status"], "rejected")
        self.assertEqual(summary["findingCodes"], ["secret-env-assignment"])
        self.assertEqual(set(summary), {"schemaVersion", "status", "byteCount", "findingCodes"})
        self.assertNotIn(secret, repr(summary))


if __name__ == "__main__":
    unittest.main()
