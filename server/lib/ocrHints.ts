/** Estrae barcode, nome e marca dal testo OCR grezzo */

export interface OcrSearchHints {
  barcode?: string;
  productName?: string;
  brand?: string;
}

export function extractBarcode(text: string): string | undefined {
  const ean = text.match(/\b(\d{13})\b/);
  if (ean) return ean[1];
  const other = text.match(/\b(\d{8}|\d{12,14})\b/g);
  return other?.[other.length - 1];
}

function cleanLine(line: string): string {
  return line.replace(/\s+/g, " ").trim();
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

  const skipPattern =
    /^(ingredienti|ingredients|allergeni|netto|peso|e\s*an|lotto|scadenza|barcode|codice)/i;

  let productName: string | undefined;
  for (const line of lines.slice(0, 8)) {
    if (skipPattern.test(line)) continue;
    if (/^\d+$/.test(line)) continue;
    if (line.length < 2 || line.length > 80) continue;
    productName = line;
    break;
  }

  if (!brand && lines[0] && lines[0].length <= 25 && !skipPattern.test(lines[0])) {
    brand = lines[0];
    if (lines[1] && !skipPattern.test(lines[1]) && !productName) {
      productName = lines[1];
    }
  }

  const idx = lines.findIndex((l) => /^ingredienti/i.test(l));
  if (!productName && idx > 0) productName = lines[idx - 1];

  return { barcode, productName, brand };
}
