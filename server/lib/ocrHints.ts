/** Estrae barcode, nome e marca dal testo OCR grezzo */

import { isValidEan, sanitizeBarcode } from "./barcode";

export interface OcrSearchHints {
  barcode?: string;
  productName?: string;
  brand?: string;
}

export function extractBarcode(text: string): string | undefined {
  const candidates = text.match(/\b(\d{8}|\d{12,14})\b/g) ?? [];
  for (let i = candidates.length - 1; i >= 0; i--) {
    const code = candidates[i]!;
    if (isValidEan(code)) return code;
  }
  return undefined;
}

function cleanLine(line: string): string {
  return line.replace(/\s+/g, " ").trim();
}

function normalizeToken(value: string): string {
  return value
    .toLowerCase()
    .normalize("NFD")
    .replace(/\p{M}/gu, "")
    .trim();
}

const SKIP_LINE =
  /^(ingredienti|ingredients|allergeni|netto|peso|e\s*an|lotto|scadenza|barcode|codice|l['']immagine|prodotto in|made in|fabbricato in)/i;

const CLAIM_OR_TAGLINE =
  /^(100%|ricco di|senza |no |privo|vegan|bio|organic|fair trade|bontà|salute|gusto|zero |free |gluten)/i;

const WEIGHT_LINE = /^\d+\s*[x×]\s*\d+/i;

function isClaimOrTagline(line: string): boolean {
  const norm = normalizeToken(line);
  if (CLAIM_OR_TAGLINE.test(line) || CLAIM_OR_TAGLINE.test(norm)) return true;
  return /^(bonta e salute|100 vegetale)$/.test(norm);
}

function isBrandLine(line: string, brand?: string): boolean {
  if (!brand) return false;
  const lineNorm = normalizeToken(line);
  const brandNorm = normalizeToken(brand);
  return lineNorm === brandNorm || lineNorm.startsWith(`${brandNorm} `);
}

function inferProductName(lines: string[], brand?: string): string | undefined {
  const nameParts: string[] = [];

  for (const line of lines.slice(0, 14)) {
    if (SKIP_LINE.test(line)) break;
    if (/^\d+$/.test(line)) continue;
    if (WEIGHT_LINE.test(line)) continue;
    if (line.length < 2 || line.length > 60) continue;
    if (isBrandLine(line, brand)) continue;
    if (isClaimOrTagline(line)) continue;

    const looksLikeNamePart =
      /^[A-ZÀ-Ü0-9][A-ZÀ-Ü0-9\s\-']*$/.test(line) && line.length <= 28 && !line.includes(",");

    if (looksLikeNamePart) {
      nameParts.push(line);
      if (nameParts.length >= 3) break;
      continue;
    }

    if (!nameParts.length) return line;
    break;
  }

  if (nameParts.length) return nameParts.join(" ");
  return undefined;
}

/** Heuristiche per etichette IT/EU */
export function inferHintsFromRawText(rawText: string): OcrSearchHints {
  const lines = rawText
    .split("\n")
    .map(cleanLine)
    .filter((l) => l.length > 1);

  const barcode = extractBarcode(rawText);

  let brand: string | undefined;
  const brandLine = lines.find((l) =>
    /^(marca|brand|fabbricante)\s*:?\s*/i.test(l),
  );
  if (brandLine) {
    brand = brandLine.replace(/^(marca|brand|fabbricante)\s*:?\s*/i, "").trim();
  }

  if (!brand && lines[0] && lines[0].length <= 25 && !SKIP_LINE.test(lines[0])) {
    brand = lines[0];
  }

  let productName = inferProductName(lines, brand);

  const skipPattern =
    /^(ingredienti|ingredients|allergeni|netto|peso|e\s*an|lotto|scadenza|barcode|codice)/i;

  if (!productName) {
    for (const line of lines.slice(0, 8)) {
      if (skipPattern.test(line)) continue;
      if (/^\d+$/.test(line)) continue;
      if (isBrandLine(line, brand)) continue;
      if (line.length < 2 || line.length > 80) continue;
      productName = line;
      break;
    }
  }

  const idx = lines.findIndex((l) => /^ingredienti/i.test(l));
  if (!productName && idx > 0) {
    const candidate = lines[idx - 1];
    if (candidate && !isBrandLine(candidate, brand)) productName = candidate;
  }

  return {
    barcode: sanitizeBarcode(barcode),
    productName,
    brand,
  };
}
