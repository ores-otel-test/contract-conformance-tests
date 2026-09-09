// This external consumer MUST fail compilation: u16 values are not bytes.
fn main() {
    let invalid = [256_u16; 32];
    ores_lib_core::classify_idempotency(None, &invalid);
}
