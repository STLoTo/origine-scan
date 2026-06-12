/** Estrae claim di origine da testo OCR o campo origin Open Facts */

export interface ParsedOriginClaim {
  type: "product" | "manufacturing" | "ingredient";
  ingredient?: string;
  place: string;
  raw: string;
}

const PRODUCT_PATTERNS = [
  /(?:prodotto e confezionato in|prodotto in|made in|fabbricato in|produced in|manufactured in)\s*:?\s*([^\n.;]+)/gi,
  /(?:confezionato in|packed in|assemblato in)\s*:?\s*([^\n.;]+)/gi,
];

const INGREDIENT_LINE_PATTERNS = [
  /(?:origine del(?:la|l'| i)?|origin of the?)\s+([^:\n]+?)\s*:\s*([^\n,;.]+)/gi,
  /([A-Za-zÀ-ÿ0-9][A-Za-zÀ-ÿ0-9\s\-']{2,35})\s+(?:proveniente da|provenienza)\s+(?:da|d[''])\s*([A-Za-zÀ-ÿ][A-Za-zÀ-ÿ\s\-']{2,40})/gi,
];

function cleanPlace(value: string): string {
  return value.replace(/\s+/g, " ").replace(/[.;]+$/, "").trim();
}

function cleanIngredient(value: string): string {
  return value.replace(/\s+/g, " ").trim();
}

function isValidIngredientOrigin(ingredient: string, place: string): boolean {
  if (place.length < 3 || ingredient.length < 2) return false;
  if (/^l[\s']/i.test(place)) return false;
  if (/prodotto in|made in|fabbricato|confezionato/i.test(ingredient)) return false;
  return true;
}

function pushUnique(claims: ParsedOriginClaim[], claim: ParsedOriginClaim) {
  const key = `${claim.type}|${claim.ingredient ?? ""}|${claim.place}`.toLowerCase();
  if (claims.some((c) => `${c.type}|${c.ingredient ?? ""}|${c.place}`.toLowerCase() === key)) {
    return;
  }
  claims.push(claim);
}

function parseLine(line: string, claims: ParsedOriginClaim[]) {
  const trimmed = line.trim();
  if (!trimmed) return;

  for (const re of PRODUCT_PATTERNS) {
    re.lastIndex = 0;
    let match: RegExpExecArray | null;
    while ((match = re.exec(trimmed)) !== null) {
      const place = cleanPlace(match[1]!);
      if (place.length < 2) continue;
      const type = /confezionat|packed|assembl/i.test(match[0]) ? "manufacturing" : "product";
      pushUnique(claims, { type, place, raw: match[0].trim() });
    }
  }

  for (const re of INGREDIENT_LINE_PATTERNS) {
    re.lastIndex = 0;
    let match: RegExpExecArray | null;
    while ((match = re.exec(trimmed)) !== null) {
      const ingredient = cleanIngredient(match[1]!);
      const place = cleanPlace(match[2]!);
      if (!isValidIngredientOrigin(ingredient, place)) continue;
      pushUnique(claims, {
        type: "ingredient",
        ingredient,
        place,
        raw: match[0].trim(),
      });
    }
  }

  const fromMatch = trimmed.match(
    /^([A-Za-zÀ-ÿ][A-Za-zÀ-ÿ\s\-']{2,30})\s+from\s+([A-Za-zÀ-ÿ][A-Za-zÀ-ÿ\s\-']{2,30})$/i,
  );
  if (fromMatch && isValidIngredientOrigin(fromMatch[1]!, fromMatch[2]!)) {
    pushUnique(claims, {
      type: "ingredient",
      ingredient: cleanIngredient(fromMatch[1]!),
      place: cleanPlace(fromMatch[2]!),
      raw: fromMatch[0].trim(),
    });
  }
}

/** Parse claim origine da blocco testo (OCR o campo origin OFF) */
export function parseOriginsFromText(text: string): ParsedOriginClaim[] {
  const claims: ParsedOriginClaim[] = [];
  if (!text?.trim()) return claims;

  for (const line of text.split("\n")) {
    parseLine(line, claims);
  }

  // Frasi inglesi inline nel blocco OFF (es. "Tomatoes from Italy. Made in France.")
  const inlineFrom = text.matchAll(
    /\b([A-Za-zÀ-ÿ][A-Za-zÀ-ÿ\s\-']{2,30})\s+from\s+([A-Za-zÀ-ÿ][A-Za-zÀ-ÿ\s\-']{2,30})\b/gi,
  );
  for (const match of inlineFrom) {
    const ingredient = cleanIngredient(match[1]!);
    const place = cleanPlace(match[2]!);
    if (!isValidIngredientOrigin(ingredient, place)) continue;
    pushUnique(claims, {
      type: "ingredient",
      ingredient,
      place,
      raw: match[0].trim(),
    });
  }

  return claims;
}

/** Claim generici già estratti (retrocompatibilità OCR) */
export function expandLegacyOriginClaims(lines: string[]): ParsedOriginClaim[] {
  const claims: ParsedOriginClaim[] = [];
  for (const line of lines) {
    parseLine(line, claims);
  }
  return claims;
}
