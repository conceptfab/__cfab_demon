// @public-api — używane przez UI eksportu/importu sekretu grupy (E2E v2, model B).
//
// Portable, human/QR-friendly kodowanie sekretu grupy do przenoszenia między
// urządzeniami. Format: `TFGK1-<base64url(payload)>-<crc16 hex>`. CRC wykrywa
// literówki i ucięcia przy ręcznym imporcie (nie jest zabezpieczeniem krypto).

const PREFIX = 'TFGK1'; // TimeFlow Group Key v1

function crc16(input: string): number {
  let crc = 0xffff;
  for (let i = 0; i < input.length; i++) {
    crc ^= input.charCodeAt(i);
    for (let j = 0; j < 8; j++) {
      crc = crc & 1 ? (crc >>> 1) ^ 0xa001 : crc >>> 1;
    }
  }
  return crc & 0xffff;
}

function toBase64Url(s: string): string {
  const bin = String.fromCharCode(...new TextEncoder().encode(s));
  return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function fromBase64Url(b64url: string): string | null {
  try {
    const b64 = b64url.replace(/-/g, '+').replace(/_/g, '/');
    const bin = atob(b64);
    const bytes = Uint8Array.from(bin, (c) => c.charCodeAt(0));
    return new TextDecoder().decode(bytes);
  } catch {
    return null;
  }
}

/** Koduje sekret grupy do przenośnego stringa (eksport / QR). */
export function encodeGroupSecret(passphrase: string): string {
  const payload = toBase64Url(passphrase);
  const crc = crc16(payload).toString(16).padStart(4, '0');
  return `${PREFIX}-${payload}-${crc}`;
}

/**
 * Dekoduje przenośny string do passphrase. Zwraca `null` przy złym formacie,
 * niezgodnej sumie kontrolnej (literówka/ucięcie) lub uszkodzonym base64.
 */
export function decodeGroupSecret(encoded: string): string | null {
  const trimmed = encoded.trim();
  const parts = trimmed.split('-');
  if (parts.length !== 3) return null;
  const [prefix, payload, crc] = parts;
  if (prefix !== PREFIX || !payload || !crc) return null;
  if (crc16(payload).toString(16).padStart(4, '0') !== crc.toLowerCase()) return null;
  return fromBase64Url(payload);
}
