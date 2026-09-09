// Synthetic test data only. Expected policy is independent of the implementation.
export const CORE_COMMIT = '6ce47f202cef70112950b06af8c3c24abe7eb288';
export const BASELINE_COMMIT = '5db0c66a85098fa3eff55d2df929d078999712e2';
export function cases() {
  const rows = [];
  const add = (kind, input, expected) => rows.push({ id: `case-${rows.length}`, kind, input, expected });
  const email = (input, expected = null) => add('email', input, expected);
  const correlation = (input, expected) => add('correlation', input, expected);
  email('Alice+Ops@EXAMPLE.COM', 'alice+ops@example.com');
  email(' \tAlice+Ops@EXAMPLE.COM\r\n', 'alice+ops@example.com');
  const atext = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789.!#$%&'*+-/=?^_`{|}~";
  const ids = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789._:-';
  for (let code = 0; code < 128; code += 1) {
    const char = String.fromCharCode(code);
    const input = `a${char}b@example.com`;
    email(input, atext.includes(char) ? input.toLowerCase() : null);
    correlation(`request-${char}-id`, ids.includes(char));
  }
  for (let length = 0; length <= 130; length += 1) correlation('a'.repeat(length), length >= 8 && length <= 128);
  for (const length of [1, 63, 64, 65]) {
    const value = `${'a'.repeat(length)}@example.com`;
    email(value, length <= 64 ? value : null);
  }
  const domain = Array(4).fill('x'.repeat(63)).join('.');
  email(`${'a'.repeat(64)}@${domain}`, `${'a'.repeat(64)}@${domain}`); // 320 ASCII bytes
  email(`${'a'.repeat(65)}@${domain}`);
  for (const input of ['', ' \t\r\n', 'a..b@example.com', '.a@example.com', 'a.@example.com',
    'a@localhost', 'a@@example.com', 'a@-example.com', 'a@example-.com', 'a@example..com',
    'a@.example.com', 'a@example.com.', `a@${'x'.repeat(64)}.com`]) email(input);
  // Deterministic samples across all Unicode planes, plus normalization edge cases.
  const points = new Set([0x80, 0x85, 0xa0, 0x130, 0x301, 0x200b, 0x2028, 0x2029, 0x212a, 0xfeff, 0xff20, 0x1f600, 0x10ffff]);
  for (let index = 0; index < 1024; index += 1) {
    const code = 128 + (index * 104729) % (0x110000 - 128);
    if (code < 0xd800 || code > 0xdfff) points.add(code);
  }
  for (const code of [...points].sort((a, b) => a - b)) {
    const char = String.fromCodePoint(code);
    email(`${char}@example.com`);
    email(`a@${char}.example`);
    correlation(`request-${char}-id`, false);
  }
  return rows;
}
