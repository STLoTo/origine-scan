import type { FlatOpenProduct } from "./openFactsClient";

const STOP_WORDS = new Set([
  "valsoia",
  "prodotto",
  "immagine",
  "scopo",
  "presentare",
  "vegetale",
  "naturale",
  "added",
  "senza",
  "sale",
  "ricco",
  "proteine",
  "bontà",
  "salute",
  "marca",
  "brand",
]);

/** Coppie di termini OCR vs DB che indicano prodotti diversi */
const HARD_CONFLICTS: Array<{ ocr: RegExp; db: RegExp }> = [
  { ocr: /\btofu\b/i, db: /\b(nocciol|hazelnut|cacao|spalmab|spread|crema)\b/i },
  { ocr: /\byogurt\b/i, db: /\b(pasta|ragù|sugo)\b/i },
  { ocr: /\blatte\b/i, db: /\b(tofu|seitan)\b/i },
];

function normalizeText(text: string): string {
  return text
    .toLowerCase()
    .normalize("NFD")
    .replace(/\p{M}/gu, "")
    .replace(/[^\p{L}\p{N}\s]/gu, " ");
}

function tokenize(text: string, excludeBrand?: string): string[] {
  const brandNorm = excludeBrand ? normalizeText(excludeBrand) : "";
  return normalizeText(text)
    .split(/\s+/)
    .filter((w) => w.length >= 3)
    .filter((w) => !STOP_WORDS.has(w))
    .filter((w) => !brandNorm || w !== brandNorm);
}

/** Punteggio 0–1 tra testo OCR e record Open Facts */
export function scoreProductAgainstOcr(
  ocrText: string,
  product: Pick<FlatOpenProduct, "product_name" | "brands" | "categories" | "ingredients_text">,
  brand?: string,
): number {
  const ocrTokens = tokenize(ocrText, brand);
  if (!ocrTokens.length) return 0.5;

  const dbText = [product.product_name, product.categories, product.ingredients_text]
    .filter(Boolean)
    .join(" ");
  const dbBlob = normalizeText(dbText);

  let hits = 0;
  for (const token of ocrTokens) {
    if (dbBlob.includes(token)) hits += 1;
  }

  return hits / ocrTokens.length;
}

export function hasHardProductConflict(ocrText: string, product: FlatOpenProduct): boolean {
  const dbText = [product.product_name, product.categories, product.ingredients_text]
    .filter(Boolean)
    .join(" ");

  return HARD_CONFLICTS.some(({ ocr, db }) => ocr.test(ocrText) && db.test(dbText));
}

/** True se il match DB non è coerente con quanto letto sull'etichetta */
export function isOcrDatabaseMismatch(
  ocrText: string,
  product: FlatOpenProduct,
  brand?: string,
  minScore = 0.2,
): boolean {
  if (hasHardProductConflict(ocrText, product)) return true;
  return scoreProductAgainstOcr(ocrText, product, brand) < minScore;
}
