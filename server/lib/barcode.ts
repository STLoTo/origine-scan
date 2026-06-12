/** Validazione codici EAN/UPC (checksum modulo 10) */

const VALID_LENGTHS = new Set([8, 12, 13, 14]);

function checksumDigit(payload: string): number {
  let sum = 0;
  for (let i = 0; i < payload.length; i++) {
    const digit = parseInt(payload[payload.length - 1 - i]!, 10);
    sum += digit * (i % 2 === 0 ? 3 : 1);
  }
  return (10 - (sum % 10)) % 10;
}

export function isValidEan(code: string): boolean {
  const digits = code.replace(/\D/g, "");
  if (!VALID_LENGTHS.has(digits.length)) return false;
  if (!/^\d+$/.test(digits)) return false;

  const expected = checksumDigit(digits.slice(0, -1));
  return expected === parseInt(digits.at(-1)!, 10);
}

/** Normalizza e accetta solo barcode con checksum valido */
export function sanitizeBarcode(code?: string): string | undefined {
  const trimmed = code?.trim();
  if (!trimmed) return undefined;
  const digits = trimmed.replace(/\D/g, "");
  return isValidEan(digits) ? digits : undefined;
}
