import { describe, it, expect } from 'vitest';

import { encodeGroupSecret, decodeGroupSecret } from '../group-secret-codec';
import { generateGroupPassphrase } from '@/lib/tauri/online-sync';

describe('group-secret-codec (E2E v2 export/import, model B)', () => {
  it('round-trips a generated passphrase', () => {
    const secret = generateGroupPassphrase();
    const encoded = encodeGroupSecret(secret);
    expect(encoded.startsWith('TFGK1-')).toBe(true);
    expect(decodeGroupSecret(encoded)).toBe(secret);
  });

  it('round-trips arbitrary UTF-8 secrets', () => {
    const secret = 'cafe-uber-\u65e5\u672c-euro-secret';
    expect(decodeGroupSecret(encodeGroupSecret(secret))).toBe(secret);
  });

  it('tolerates surrounding whitespace on import', () => {
    const encoded = encodeGroupSecret('abc');
    expect(decodeGroupSecret(`  ${encoded}\n`)).toBe('abc');
  });

  it('rejects a checksum mismatch (typo / truncation)', () => {
    const encoded = encodeGroupSecret('secret');
    // Flip the last char of the payload segment.
    const [prefix, payload, crc] = encoded.split('-');
    const flipped = `${payload!.slice(0, -1)}${payload!.slice(-1) === 'A' ? 'B' : 'A'}`;
    expect(decodeGroupSecret(`${prefix}-${flipped}-${crc}`)).toBeNull();
  });

  it('rejects wrong prefix and malformed input', () => {
    expect(decodeGroupSecret('NOPE-abc-0000')).toBeNull();
    expect(decodeGroupSecret('garbage')).toBeNull();
    expect(decodeGroupSecret('')).toBeNull();
  });
});
