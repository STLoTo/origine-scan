/** Analisi e pulizia del testo OCR (food, cosmetici, detergenti) */

export type LabelKind = "food" | "cosmetic" | "cleaning" | "unknown";

export interface OcrTextAnalysis {
  labelKind: LabelKind;
  warnings: string[];
  cleanedText: string;
  ingredients?: string;
}

const INGREDIENTS_HEADER =
  /^(?:ingredienti|ingredients|ingr[eé]dients|inhaltsstoffe|zutaten|composition)\s*:?\s*$/i;

const INGREDIENTS_INLINE =
  /(?:ingredienti|ingredients|ingr[eé]dients|inhaltsstoffe|zutaten|composition)\s*:?\s*/i;

const INGREDIENTS_STOP =
  /^(?:allerg[eè]nes?|allergens|allergeni|inhaltsstoffe|zutaten|conservare|conservation|netto|peso|tenir|keep out|en cas de|ne pas)\b/i;

/** Avvertenze CLP / sicurezza — non sono nome prodotto */
export const SAFETY_LINE =
  /^(?:en cas de|ne pas |tenir hors|appeler un|pr[eé]venir les|ne pas donner|n cas de|in case of|keep out|call a doctor|bei kontakt|achtung|warning|danger|attention|irritation|intoxic|vomit|m[eé]decin|antipoison|lentilles|rincer|laver à l)/i;

const CLEANING_SIGNALS =
  /agents de surface|tenside|sodium laureth|sodium lauryl|detergent|nettoyant|liquide vaisselle|household|cleaning|surface active|waschmittel|reinigungsmittel/i;

const COSMETIC_SIGNALS =
  /parfum|aqua\/water|shampoo|shower gel|body wash|cosm[eé]tique|capelli|corpo|viso|lotion|cr[eè]me douche/i;

const FOOD_SIGNALS =
  /(?:^|\n)ingredienti\b|allergeni|nutri(?:tion|ente)|kcal|kj\b|prodotto in|made in|fabbricato in|vegan food|aliment/i;

/** Numeri implausibili in INCI (allucinazione vision) */
const HALLUCINATED_TRIDECETH = /Sodium Trideceth-(?:[4-9]\d{2,}|\d{4,})\s+Sulfate/gi;

function cleanLine(line: string): string {
  return line.replace(/\s+/g, " ").trim();
}

export function isSafetyOrInstructionLine(line: string): boolean {
  const trimmed = cleanLine(line);
  if (trimmed.length < 3) return true;
  return SAFETY_LINE.test(trimmed);
}

export function detectLabelKind(text: string): LabelKind {
  if (CLEANING_SIGNALS.test(text)) return "cleaning";
  if (COSMETIC_SIGNALS.test(text)) return "cosmetic";
  if (FOOD_SIGNALS.test(text)) return "food";
  if (/inhaltsstoffe|ingr[eé]dients/i.test(text) && /parfum|aqua|tenside|surface/i.test(text)) {
    return "cleaning";
  }
  return "unknown";
}

/** Rimuove ripetizioni INCI improbabili generate dal modello vision */
export function sanitizeHallucinatedOcr(rawText: string): { text: string; warnings: string[] } {
  const warnings: string[] = [];
  let text = rawText;

  if (HALLUCINATED_TRIDECETH.test(rawText)) {
    warnings.push(
      "Possibile allucinazione OCR: lista tensioattivi con numeri implausibili (es. Trideceth-10000). " +
        "Verifica l'etichetta originale.",
    );
    text = text.replace(HALLUCINATED_TRIDECETH, "");
    text = text.replace(/,\s*,/g, ", ").replace(/\s{2,}/g, " ");
  }

  const tridecethCount = (rawText.match(/Sodium Trideceth-\d+/gi) ?? []).length;
  if (tridecethCount > 12) {
    warnings.push(
      `Lista ingredienti sospetta: ${tridecethCount} varianti «Sodium Trideceth-*» — probabile errore OCR.`,
    );
  }

  return { text: text.trim(), warnings };
}

function extractIngredientsBlock(rawText: string): string | undefined {
  const multiline = rawText.match(
    /(?:ingredienti|ingredients|ingr[eé]dients|inhaltsstoffe|zutaten|composition)\s*:?\s*\n([\s\S]{10,2000}?)(?:\n\s*\n|\n(?:allerg[eè]nes?|allergens|allergeni|inhaltsstoffe|zutaten|tenir|keep out)\b|$)/i,
  );
  if (multiline?.[1]?.trim()) {
    return multiline[1].replace(/\s+/g, " ").replace(/,\s*,/g, ", ").trim().slice(0, 1500);
  }

  const lines = rawText.split("\n").map(cleanLine);
  const blocks: string[] = [];

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]!;
    const inline = line.match(
      new RegExp(`${INGREDIENTS_INLINE.source}(.+)`, "i"),
    );

    if (inline?.[1]?.trim()) {
      blocks.push(inline[1].trim());
      continue;
    }

    if (!INGREDIENTS_HEADER.test(line)) continue;

    const chunk: string[] = [];
    for (let j = i + 1; j < lines.length; j++) {
      const next = lines[j]!;
      if (!next) continue;
      if (INGREDIENTS_HEADER.test(next) || INGREDIENTS_STOP.test(next)) break;
      if (isSafetyOrInstructionLine(next)) break;
      chunk.push(next);
      if (chunk.join(" ").length > 1200) break;
    }

    if (chunk.length) blocks.push(chunk.join(" "));
  }

  if (!blocks.length) return undefined;

  const merged = blocks[0]!
    .replace(/\s+/g, " ")
    .replace(/,\s*,/g, ", ")
    .trim();

  return merged.length >= 10 ? merged.slice(0, 1500) : undefined;
}

export function analyzeOcrText(rawText: string): OcrTextAnalysis {
  const { text: cleanedText, warnings } = sanitizeHallucinatedOcr(rawText);
  const labelKind = detectLabelKind(cleanedText);
  const ingredients = extractIngredientsBlock(cleanedText);

  if (labelKind === "cleaning" || labelKind === "cosmetic") {
    warnings.push(
      labelKind === "cleaning"
        ? "Etichetta detergente/igienizzante rilevata — Open Beauty Facts / Open Products Facts, non alimentare."
        : "Etichetta cosmetica rilevata — ricerca su Open Beauty Facts.",
    );
  }

  if (!ingredients && /ingr[eé]dients|inhaltsstoffe|ingredienti/i.test(cleanedText)) {
    warnings.push("Sezione ingredienti presente ma non estratta completamente — controlla il testo grezzo.");
  }

  return { labelKind, warnings, cleanedText, ingredients };
}
