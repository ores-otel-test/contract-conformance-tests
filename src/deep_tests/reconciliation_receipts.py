"""Content-free safety checks for oresc reconciliation receipts.

The scanner reports stable finding codes and byte counts only. It never returns
matched values, surrounding text, or line contents.
"""
from __future__ import annotations

from dataclasses import dataclass
import re
from typing import Final

MAX_RECEIPT_BYTES: Final = 1_048_576


class ReceiptLimitError(ValueError):
    """Raised before parsing when a receipt exceeds the configured byte bound."""


@dataclass(frozen=True, slots=True)
class ReceiptScan:
    byte_count: int
    finding_codes: tuple[str, ...]

    @property
    def accepted(self) -> bool:
        return not self.finding_codes

    def summary(self) -> dict[str, object]:
        """Return a value-free machine-readable summary."""
        return {
            "schemaVersion": "oresc.reconciliation-receipt-scan.v1",
            "status": "accepted" if self.accepted else "rejected",
            "byteCount": self.byte_count,
            "findingCodes": list(self.finding_codes),
        }


_TOKEN_PATTERNS: Final[tuple[tuple[str, re.Pattern[str]], ...]] = (
    (
        "github-token",
        re.compile(
            r"(?:gh" + r"p_[A-Za-z0-9]{20,}|github_" + r"pat_[A-Za-z0-9_]{20,})"
        ),
    ),
    ("linear-token", re.compile(r"lin_" + r"api_[A-Za-z0-9]{20,}")),
    ("supabase-token", re.compile(r"sb_" + r"secret_[A-Za-z0-9_-]{20,}")),
    ("aws-access-key", re.compile(r"AKIA[A-Z0-9]{16}")),
    (
        "bearer-token",
        re.compile(
            r"Authorization\s*:\s*Bearer\s+[A-Za-z0-9._~+/=-]{20,}",
            re.IGNORECASE,
        ),
    ),
    (
        "jwt",
        re.compile(
            r"(?<![A-Za-z0-9_-])[A-Za-z0-9_-]{16,}\.[A-Za-z0-9_-]{16,}\."
            r"[A-Za-z0-9_-]{16,}(?![A-Za-z0-9_-])"
        ),
    ),
)

_PRIVATE_KEY_PATTERN: Final = re.compile(
    r"-{5}"
    + re.escape("BEGIN")
    + r"(?: [A-Z]+)? "
    + re.escape("PRIVATE")
    + r" "
    + re.escape("KEY")
    + r"-{5}"
)
_DATABASE_CREDENTIAL_PATTERN: Final = re.compile(
    r"\b(?:postgres(?:ql)?|redis|mysql|https?)://[^\s/:@]+:[^\s/@]+@",
    re.IGNORECASE,
)
_SECRET_ASSIGNMENT_PATTERN: Final = re.compile(
    r"(?im)^\s*(?:GH_TOKEN|GITHUB_TOKEN|FLEET_READ_TOKEN|ORES_CLI_READ_TOKEN|"
    r"DATABASE_URL|AWS_SECRET_ACCESS_KEY)\s*=\s*\S+"
)
_SENSITIVE_PAYLOAD_PATTERN: Final = re.compile(
    r"(?im)^\s*(?:cache_value|prompt|answer|message_body|document_content|"
    r"signature_value)\s*[:=]\s*\S+"
)


def _byte_length(value: str) -> int:
    return len(value.encode("utf-8"))


def scan_receipt(
    receipt: str | bytes,
    *,
    max_bytes: int = MAX_RECEIPT_BYTES,
) -> ReceiptScan:
    """Scan one bounded receipt without returning any matched source material."""
    if not isinstance(max_bytes, int) or isinstance(max_bytes, bool) or max_bytes < 1:
        raise ValueError("max_bytes must be a positive integer")
    if not isinstance(receipt, (str, bytes)):
        raise TypeError("receipt must be str or bytes")

    byte_count = len(receipt) if isinstance(receipt, bytes) else _byte_length(receipt)
    if byte_count > max_bytes:
        raise ReceiptLimitError("receipt exceeds the configured byte bound")

    if isinstance(receipt, bytes):
        try:
            text = receipt.decode("utf-8", errors="strict")
        except UnicodeDecodeError:
            return ReceiptScan(byte_count=byte_count, finding_codes=("invalid-utf8",))
    else:
        text = receipt

    findings: list[str] = []
    if "\x00" in text:
        findings.append("binary-data")

    for code, pattern in _TOKEN_PATTERNS:
        if pattern.search(text):
            findings.append(code)
    if _PRIVATE_KEY_PATTERN.search(text):
        findings.append("private-key")
    if _DATABASE_CREDENTIAL_PATTERN.search(text):
        findings.append("database-url-credentials")
    if _SECRET_ASSIGNMENT_PATTERN.search(text):
        findings.append("secret-env-assignment")
    if _SENSITIVE_PAYLOAD_PATTERN.search(text):
        findings.append("sensitive-payload-field")

    return ReceiptScan(byte_count=byte_count, finding_codes=tuple(findings))
