const ALPHABET = '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz';
const BASE = BigInt(ALPHABET.length);
const CHAR_MAP = new Map(
  [...ALPHABET].map((char, idx) => [char, BigInt(idx)])
);

export function encode(num) {
  if (typeof num !== 'bigint') {
    throw new TypeError(`base62.encode expects a BigInt, got ${typeof num}`);
  }
  if (num < 0n) {
    throw new RangeError('base62.encode does not support negative values');
  }
  if (num === 0n) return '0';

  let result = '';
  let remaining = num;

  while (remaining > 0n) {
    const remainder = remaining % BASE;
    result = ALPHABET[Number(remainder)] + result;
    remaining = remaining / BASE;
  }

  return result;
}

export function decode(str) {
  if (typeof str !== 'string') {
    throw new TypeError(`base62.decode expects a string, got ${typeof str}`);
  }

  let result = 0n;

  for (const char of str) {
    const value = CHAR_MAP.get(char);
    if (value === undefined) {
      throw new Error(`base62.decode: invalid character '${char}' not in Base62 alphabet`);
    }
    result = result * BASE + value;
  }

  return result;
}
