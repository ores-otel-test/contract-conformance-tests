import "@typespec/json-schema";
using TypeSpec.JsonSchema;

namespace OresOtelTelemetryPolicy;

@id("TelemetryPolicyV1")
model TelemetryPolicyV1 {
  @minValue(1)
  @maxValue(1)
  version: integer;

  @minLength(1)
  @maxLength(128)
  service: string;

  @minValue(0)
  @maxValue(1000)
  sample_per_mille: integer;

  @minValue(100)
  @maxValue(60000)
  export_timeout_ms: integer;

  redact_payloads: boolean;
}
