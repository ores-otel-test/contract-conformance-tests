import "@typespec/json-schema";
using TypeSpec.JsonSchema;

namespace OresOtelCanary;

@id("OtelPolicyCanary")
model OtelPolicyCanary {
  @minValue(1)
  @maxValue(1)
  version: integer;

  server: {
    @minLength(1)
    @maxLength(128)
    service_name: string;

    tracing: {
      @minValue(0)
      @maxValue(1)
      sample_ratio: float64;
      propagators: string[];
    };

    exporter: {
      @minLength(1)
      @maxLength(32)
      protocol: string;
      @minLength(1)
      @maxLength(128)
      endpoint_env: string;
    };
  };
}
