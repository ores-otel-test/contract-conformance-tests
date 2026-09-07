"""Fail-closed ORES shared-stack telemetry attribute model.

This module is intentionally dependency-free and deterministic.  It models the
boundary between middleware/auth/rate-limit/Redis state and an OTel exporter; it
does not perform network I/O and never hashes raw identities itself.  Producers
must supply pre-derived keyed HMAC identifiers.
"""

from __future__ import annotations

from dataclasses import dataclass
import re
from types import MappingProxyType
from typing import Any, Mapping


class TelemetryContractError(ValueError):
    """A producer attempted to cross the telemetry boundary unsafely."""


OPAQUE_HASH = re.compile(r"^hmac-sha256:[0-9a-f]{64}$")
REQUEST_ID = re.compile(r"^req_[0-9a-f]{32}$")
TRACE_ID = re.compile(r"^[0-9a-f]{32}$")
SPAN_ID = re.compile(r"^[0-9a-f]{16}$")
ROUTE_ID = re.compile(r"^[a-z][a-z0-9_.-]{2,95}$")
POLICY_ID = re.compile(r"^[a-z][a-z0-9_.-]{2,95}$")
SERVICE_NAME = re.compile(r"^[a-z][a-z0-9_.-]{2,95}$")
ERROR_TYPE = re.compile(r"^[A-Za-z][A-Za-z0-9_.:-]{0,95}$")

FORBIDDEN_KEY = re.compile(
    r"(?:authorization|cookie|token|secret|password|credential|private[_-]?key|"
    r"database(?:[_\-.]?url|[_\-.]?dsn)?|connection[_\-.]?string|prompt|answer|"
    r"message(?:[_\-.]?(?:body|content|text))?|document|signature|initial|email|"
    r"phone|address|session|claim|raw[_\-.]?ip|client[_\-.]?ip|rate[_\-.]?key|"
    r"cache[_\-.]?(?:key|value))",
    re.IGNORECASE,
)
FORBIDDEN_VALUE = re.compile(
    r"(?:bearer\s+|basic\s+|postgres(?:ql)?://|redis://|https?://[^/\s]*@|"
    r"-----BEGIN [A-Z ]*PRIVATE KEY-----|[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,})",
    re.IGNORECASE,
)

CORE_ATTRIBUTE_KEYS = frozenset(
    {
        "request.id",
        "tenant.hash",
        "principal.hash",
        "route.id",
        "auth.realm",
        "rate.policy",
        "rate.decision",
        "cache.revision",
        "cache.source",
    }
)
OPTIONAL_ATTRIBUTE_KEYS = frozenset(
    {
        "deployment.environment.name",
        "error.type",
        "http.request.method",
        "http.response.status_code",
        "redis.operation",
        "redis.outcome",
        "retry.attempt",
        "rpc.system",
        "service.name",
    }
)
ALLOWED_ATTRIBUTE_KEYS = CORE_ATTRIBUTE_KEYS | OPTIONAL_ATTRIBUTE_KEYS

REALMS = frozenset({"public", "customer", "admin", "internal"})
RATE_DECISIONS = frozenset({"allow", "deny", "unavailable", "not_checked"})
CACHE_SOURCES = frozenset({"redis", "local-denial", "miss", "none"})
ENVIRONMENTS = frozenset({"production", "staging", "test"})
HTTP_METHODS = frozenset({"GET", "HEAD", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"})
RPC_SYSTEMS = frozenset({"http", "jsonrpc", "grpc", "nats", "mcp"})
REDIS_OPERATIONS = frozenset({"get", "eval", "publish", "subscribe", "poll", "reconcile"})
REDIS_OUTCOMES = frozenset({"allow", "deny", "hit", "miss", "unavailable", "repaired"})


def _require(condition: bool, message: str) -> None:
    if not condition:
        raise TelemetryContractError(message)


def _require_string(value: Any, name: str, pattern: re.Pattern[str]) -> str:
    _require(isinstance(value, str), f"{name} must be a string")
    _require(pattern.fullmatch(value) is not None, f"{name} has an invalid format")
    _require("\n" not in value and "\r" not in value, f"{name} must be one line")
    return value


def _validate_optional_value(key: str, value: Any) -> Any:
    if key == "deployment.environment.name":
        _require(value in ENVIRONMENTS, f"{key} is invalid")
    elif key == "error.type":
        _require_string(value, key, ERROR_TYPE)
    elif key == "http.request.method":
        _require(value in HTTP_METHODS, f"{key} is invalid")
    elif key == "http.response.status_code":
        _require(type(value) is int and 100 <= value <= 599, f"{key} is invalid")
    elif key == "redis.operation":
        _require(value in REDIS_OPERATIONS, f"{key} is invalid")
    elif key == "redis.outcome":
        _require(value in REDIS_OUTCOMES, f"{key} is invalid")
    elif key == "retry.attempt":
        _require(type(value) is int and 0 <= value <= 1_000, f"{key} is invalid")
    elif key == "rpc.system":
        _require(value in RPC_SYSTEMS, f"{key} is invalid")
    elif key == "service.name":
        _require_string(value, key, SERVICE_NAME)
    else:  # pragma: no cover - caller checks the allowlist first
        raise TelemetryContractError(f"unsupported telemetry attribute {key!r}")
    if isinstance(value, str):
        _require(len(value) <= 128, f"{key} is too long")
        _require(FORBIDDEN_VALUE.search(value) is None, f"{key} contains sensitive-shaped material")
    return value


@dataclass(frozen=True, slots=True)
class SharedStackContext:
    """Pre-redacted shared request context accepted by an OTel producer."""

    request_id: str
    trace_id: str
    span_id: str
    tenant_hash: str
    principal_hash: str
    route_id: str
    realm: str
    rate_policy: str
    rate_decision: str
    cache_revision: int
    cache_source: str

    def validate(self) -> None:
        _require_string(self.request_id, "request_id", REQUEST_ID)
        _require_string(self.trace_id, "trace_id", TRACE_ID)
        _require(self.trace_id != "0" * 32, "trace_id must not be all zero")
        _require_string(self.span_id, "span_id", SPAN_ID)
        _require(self.span_id != "0" * 16, "span_id must not be all zero")
        _require_string(self.tenant_hash, "tenant_hash", OPAQUE_HASH)
        _require_string(self.principal_hash, "principal_hash", OPAQUE_HASH)
        _require_string(self.route_id, "route_id", ROUTE_ID)
        _require(self.realm in REALMS, "realm is invalid")
        _require_string(self.rate_policy, "rate_policy", POLICY_ID)
        _require(self.rate_decision in RATE_DECISIONS, "rate_decision is invalid")
        _require(type(self.cache_revision) is int and self.cache_revision >= 0, "cache_revision is invalid")
        _require(self.cache_source in CACHE_SOURCES, "cache_source is invalid")
        if self.cache_source == "local-denial":
            _require(self.rate_decision == "deny", "local-denial cache source requires a deny decision")
        if self.rate_decision == "not_checked":
            _require(self.cache_source == "none", "not_checked rate decision requires cache source none")

    def attributes(self) -> dict[str, Any]:
        self.validate()
        return {
            "auth.realm": self.realm,
            "cache.revision": self.cache_revision,
            "cache.source": self.cache_source,
            "principal.hash": self.principal_hash,
            "rate.decision": self.rate_decision,
            "rate.policy": self.rate_policy,
            "request.id": self.request_id,
            "route.id": self.route_id,
            "tenant.hash": self.tenant_hash,
        }


@dataclass(frozen=True, slots=True)
class ExportRecord:
    """A deterministic exporter-safe record."""

    trace_id: str
    span_id: str
    attributes: Mapping[str, Any]
    dropped_attribute_count: int

    def receipt(self) -> dict[str, Any]:
        """Return evidence that contains names and counts, never attribute values."""

        return {
            "schemaVersion": "ores.otel.redaction-receipt.v1",
            "traceIdPresent": bool(self.trace_id),
            "spanIdPresent": bool(self.span_id),
            "attributeKeys": sorted(self.attributes),
            "attributeCount": len(self.attributes),
            "droppedAttributeCount": self.dropped_attribute_count,
        }


def build_export_record(
    context: SharedStackContext,
    operational_attributes: Mapping[str, Any] | None = None,
) -> ExportRecord:
    """Build a strict record from trusted, typed producer attributes.

    Unknown or sensitive keys are errors. This is the normal producer boundary.
    """

    context.validate()
    attributes = context.attributes()
    for key, value in (operational_attributes or {}).items():
        _require(isinstance(key, str), "attribute key must be a string")
        _require(FORBIDDEN_KEY.search(key) is None, f"forbidden telemetry attribute {key!r}")
        _require(key in OPTIONAL_ATTRIBUTE_KEYS, f"unknown telemetry attribute {key!r}")
        attributes[key] = _validate_optional_value(key, value)
    assert_export_safe(context.trace_id, context.span_id, attributes)
    return ExportRecord(
        trace_id=context.trace_id,
        span_id=context.span_id,
        attributes=MappingProxyType(dict(sorted(attributes.items()))),
        dropped_attribute_count=0,
    )


def filter_untrusted_attributes(
    context: SharedStackContext,
    untrusted_attributes: Mapping[str, Any],
) -> ExportRecord:
    """Filter extension attributes without revealing rejected names or values.

    Core producer context remains strict. Unknown, sensitive, malformed, and
    high-cardinality extension fields are dropped and counted.
    """

    context.validate()
    accepted: dict[str, Any] = {}
    dropped = 0
    for key, value in untrusted_attributes.items():
        if not isinstance(key, str) or FORBIDDEN_KEY.search(key) or key not in OPTIONAL_ATTRIBUTE_KEYS:
            dropped += 1
            continue
        try:
            accepted[key] = _validate_optional_value(key, value)
        except TelemetryContractError:
            dropped += 1
    record = build_export_record(context, accepted)
    return ExportRecord(
        trace_id=record.trace_id,
        span_id=record.span_id,
        attributes=record.attributes,
        dropped_attribute_count=dropped,
    )


def assert_export_safe(trace_id: str, span_id: str, attributes: Mapping[str, Any]) -> None:
    """Validate the final record before an exporter receives it."""

    _require_string(trace_id, "trace_id", TRACE_ID)
    _require_string(span_id, "span_id", SPAN_ID)
    _require(set(attributes) <= ALLOWED_ATTRIBUTE_KEYS, "export contains an unknown attribute")
    _require(CORE_ATTRIBUTE_KEYS <= set(attributes), "export is missing a core attribute")
    for key, value in attributes.items():
        _require(FORBIDDEN_KEY.search(key) is None, f"export contains forbidden key {key!r}")
        _require(isinstance(value, (str, int)) and not isinstance(value, bool), f"{key} has an unsupported value type")
        if isinstance(value, str):
            _require(len(value) <= 128, f"{key} is too long")
            _require("\n" not in value and "\r" not in value, f"{key} must be one line")
            _require(FORBIDDEN_VALUE.search(value) is None, f"{key} contains sensitive-shaped material")


__all__ = [
    "ALLOWED_ATTRIBUTE_KEYS",
    "CORE_ATTRIBUTE_KEYS",
    "ExportRecord",
    "SharedStackContext",
    "TelemetryContractError",
    "assert_export_safe",
    "build_export_record",
    "filter_untrusted_attributes",
]
