import "@typespec/json-schema";
using TypeSpec.JsonSchema;

namespace Ores.TestDualAuthority;

@id("DualAuthorityContract")
model DualAuthorityContract {
  supabaseRoot: string;
  neonRoot: string;
  secretPolicy: string;
  promotionPolicy: string;
}
