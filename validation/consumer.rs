#![forbid(unsafe_code)]
use ores_lib_core::{classify_idempotency, normalize_email_for_revocation, valid_correlation_id, IdempotencyDisposition};

fn unhex(value: &str) -> String {
    assert_eq!(value.len() % 2, 0);
    let bytes: Vec<u8> = (0..value.len()).step_by(2)
        .map(|index| u8::from_str_radix(&value[index..index + 2], 16).expect("fixture byte"))
        .collect();
    String::from_utf8(bytes).expect("fixture Unicode scalar sequence")
}

#[test]
fn external_rust_api_replays_the_shared_corpus() {
    let mut count = 0;
    for line in include_str!("../tmp/generated/cases.tsv").lines() {
        let fields: Vec<_> = line.split('\t').collect();
        assert_eq!(fields.len(), 4);
        let input = unhex(fields[2]);
        match fields[1] {
            "email" if fields[3] == "-" => assert!(normalize_email_for_revocation(&input).is_err(), "{}", fields[0]),
            "email" => {
                let output = normalize_email_for_revocation(&input).expect("valid fixture rejected");
                assert_eq!(output, unhex(fields[3]), "{}", fields[0]);
                assert_eq!(normalize_email_for_revocation(&output).unwrap(), output);
            }
            "correlation" => {
                assert!(matches!(fields[3], "0" | "1"));
                assert_eq!(valid_correlation_id(&input), fields[3] == "1", "{}", fields[0]);
            }
            _ => panic!("unknown fixture kind"),
        }
        count += 1;
    }
    assert!(count > 3000);
    println!("shared corpus cases: {count}");
}

#[test]
fn every_digest_byte_at_every_position_matches_without_mutation() {
    let stored = [0_u8; 32];
    assert_eq!(classify_idempotency(None, &stored), IdempotencyDisposition::New);
    for index in 0..32 {
        for byte in 0..=255_u8 {
            let mut incoming = [0_u8; 32];
            incoming[index] = byte;
            let before = incoming;
            let expected = if byte == 0 { IdempotencyDisposition::Replay } else { IdempotencyDisposition::Conflict };
            assert_eq!(classify_idempotency(Some(&stored), &incoming), expected);
            assert_eq!(incoming, before);
            assert_eq!(stored, [0_u8; 32]);
        }
    }
}
