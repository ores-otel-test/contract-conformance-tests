#!/usr/bin/env bash
set -euo pipefail
case "${GITHUB_REPOSITORY_OWNER:-}" in *-test) ;; *) echo 'requires a discovered *-test organization' >&2; exit 1 ;; esac
mkdir -p tmp/evidence
# Verify identities before loading either runtime implementation.
test "$(git -C tmp/core rev-parse HEAD)" = 6ce47f202cef70112950b06af8c3c24abe7eb288
test "$(git -C tmp/baseline rev-parse HEAD)" = 5db0c66a85098fa3eff55d2df929d078999712e2
{ node --version; rustc --version; dart --version; git rev-parse HEAD; } > tmp/evidence/toolchain.txt 2>&1
node validation/generate.mjs | tee tmp/evidence/corpus.json
node --test validation/consumer.test.mjs | tee tmp/evidence/typescript.tap
rustc --edition=2021 --crate-type rlib --crate-name ores_lib_core tmp/core/langs/rust/src/lib.rs -o tmp/libores_lib_core.rlib
rustc --edition=2021 --test validation/consumer.rs --extern ores_lib_core=tmp/libores_lib_core.rlib -o tmp/rust-consumer
tmp/rust-consumer --nocapture | tee tmp/evidence/rust.txt
if rustc --edition=2021 validation/reject-invalid-digest.rs --extern ores_lib_core=tmp/libores_lib_core.rlib -o tmp/must-not-build > tmp/evidence/rust-invalid-type.txt 2>&1; then
  echo 'Rust accepted non-byte digest construction' >&2; exit 1
fi
grep -q 'E0308' tmp/evidence/rust-invalid-type.txt
dart run validation/consumer.dart | tee tmp/evidence/dart-vm.json
dart compile js validation/consumer.dart -o tmp/dart-consumer.js > tmp/evidence/dart-compile.txt
node -e 'globalThis.self = globalThis; require(process.argv[1]);' "$(pwd)/tmp/dart-consumer.js" | tee tmp/evidence/dart-js.json
cmp tmp/evidence/dart-vm.json tmp/evidence/dart-js.json
# No generated code or test instrumentation may modify the source snapshots.
test -z "$(git -C tmp/core status --porcelain --untracked-files=no)"
test -z "$(git -C tmp/baseline status --porcelain --untracked-files=no)"
