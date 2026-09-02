from __future__ import annotations

import json
import re
import unittest
from pathlib import Path, PurePosixPath


ROOT = Path(__file__).resolve().parents[1]
LOCK_PATH = ROOT / "rpc-retry" / "source-lock.json"


class RpcRetrySourceLockTests(unittest.TestCase):
    def setUp(self) -> None:
        self.lock = json.loads(LOCK_PATH.read_text(encoding="utf-8"))

    def test_source_is_immutably_pinned(self) -> None:
        self.assertEqual(
            self.lock["repository"],
            "https://github.com/ores-otel/ores-interfaces.git",
        )
        self.assertRegex(self.lock["commit"], r"\A[0-9a-f]{40}\Z")
        self.assertNotEqual(self.lock["commit"], "0" * 40)

    def test_consumed_files_are_individually_content_locked(self) -> None:
        files = self.lock["files"]
        self.assertEqual(list(files), sorted(files))
        self.assertGreaterEqual(len(files), 13)
        for raw_path, digest in files.items():
            path = PurePosixPath(raw_path)
            self.assertFalse(path.is_absolute())
            self.assertNotIn("..", path.parts)
            self.assertEqual(path.parts[:3], ("contracts", "rpc-retry", "v1"))
            self.assertTrue(re.fullmatch(r"[0-9a-f]{64}", digest), raw_path)

    def test_lock_covers_sources_toolchain_oracles_and_generated_artifacts(self) -> None:
        files = set(self.lock["files"])
        required = {
            "contracts/rpc-retry/v1/main.tsp",
            "contracts/rpc-retry/v1/tspconfig.yaml",
            "contracts/rpc-retry/v1/package.json",
            "contracts/rpc-retry/v1/package-lock.json",
            "contracts/rpc-retry/v1/buf.yaml",
            "contracts/rpc-retry/v1/instances.json",
            "contracts/rpc-retry/v1/expected/retry.proto",
            "contracts/rpc-retry/v1/expected/schema.json",
            "contracts/rpc-retry/v1/generated/protobuf/ores/rpc/v1.proto",
            "contracts/rpc-retry/v1/generated/json-schema/RetryAttempt.json",
            "contracts/rpc-retry/v1/generated/json-schema/RetryDecision.json",
            "contracts/rpc-retry/v1/generated/json-schema/RetryInput.json",
            "contracts/rpc-retry/v1/generated/json-schema/RetryPolicy.json",
        }
        self.assertEqual(files, required)


if __name__ == "__main__":
    unittest.main()
