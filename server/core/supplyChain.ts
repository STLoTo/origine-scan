import type { FlatOpenProduct } from "../lib/openFactsClient";
import { expandLegacyOriginClaims, parseOriginsFromText } from "../lib/originParser";
import type { OcrExtraction, ProductEvidence } from "../types/evidence";

export type TraceLevel = "verified" | "partial" | "unavailable";

export interface TraceItem {
  label: string;
  value?: string;
  level: TraceLevel;
  source?: string;
}

export interface IngredientOriginItem {
  ingredient: string;
  origin?: string;
  level: TraceLevel;
  source?: string;
  percentEstimate?: number;
}

export interface SupplyChainProfile {
  items: TraceItem[];
  ingredientOrigins: IngredientOriginItem[];
  overallLevel: TraceLevel;
  summary: string;
}

function formatOffTag(tag: string): string {
  const cleaned = tag.replace(/^[^:]+:\s*/, "").replace(/_/g, " ").trim();
  if (!cleaned) return tag;
  return cleaned.charAt(0).toUpperCase() + cleaned.slice(1);
}

function formatTags(tags?: string[]): string[] {
  if (!tags?.length) return [];
  return [...new Set(tags.map(formatOffTag).filter(Boolean))];
}

function splitList(value?: string): string[] {
  if (!value?.trim()) return [];
  return value.split(",").map((s) => s.trim()).filter(Boolean);
}

/** Profilo filiera unificato da OFF, OCR, dogana */
export function buildSupplyChainProfile(
  offProduct: FlatOpenProduct | null | undefined,
  ocr?: OcrExtraction,
  customs?: ProductEvidence["customs"],
): SupplyChainProfile {
  const items: TraceItem[] = [];
  const ingredientOrigins: IngredientOriginItem[] = [];
  const ingredientOriginMap = new Map<string, IngredientOriginItem>();

  function addIngredientOrigin(
    ingredient: string,
    origin: string,
    level: TraceLevel,
    source: string,
    percentEstimate?: number,
  ) {
    const key = ingredient.toLowerCase();
    const existing = ingredientOriginMap.get(key);
    if (existing && existing.level === "verified") return;
    ingredientOriginMap.set(key, {
      ingredient,
      origin,
      level,
      source,
      percentEstimate: percentEstimate ?? existing?.percentEstimate,
    });
  }

  // --- Open Facts ---
  const offOrigins = splitList(offProduct?.origins);
  const offOriginTags = formatTags(offProduct?.origins_tags);
  const offManufacturing = splitList(offProduct?.manufacturing_places);
  const offManufacturingTags = formatTags(offProduct?.manufacturing_places_tags);
  const offCountries = splitList(offProduct?.countries);
  const offOriginText = offProduct?.origin?.trim();

  if (offOriginText) {
    items.push({
      label: "Origine (testo etichetta OFF)",
      value: offOriginText,
      level: "partial",
      source: "Open Facts",
    });
    for (const claim of parseOriginsFromText(offOriginText)) {
      if (claim.type === "ingredient" && claim.ingredient) {
        addIngredientOrigin(claim.ingredient, claim.place, "partial", "Open Facts (origin)");
      }
    }
  }

  if (offOrigins.length || offOriginTags.length) {
    items.push({
      label: "Origine ingredienti",
      value: [...offOrigins, ...offOriginTags].join(", "),
      level: "partial",
      source: "Open Facts",
    });
  }

  if (offManufacturing.length || offManufacturingTags.length) {
    items.push({
      label: "Luogo di produzione / confezionamento",
      value: [...offManufacturing, ...offManufacturingTags].join(", "),
      level: "partial",
      source: "Open Facts",
    });
  }

  if (offCountries.length) {
    items.push({
      label: "Paesi di vendita",
      value: offCountries.join(", "),
      level: "partial",
      source: "Open Facts",
    });
  }

  if (offProduct?.emb_codes?.trim()) {
    items.push({
      label: "Codici tracciabilità (EMB)",
      value: offProduct.emb_codes,
      level: "verified",
      source: "Open Facts",
    });
  }

  for (const ing of offProduct?.ingredients_structured ?? []) {
    if (!ing.text) continue;
    const existing = ingredientOriginMap.get(ing.text.toLowerCase());
    ingredientOriginMap.set(ing.text.toLowerCase(), {
      ingredient: ing.text,
      origin: existing?.origin,
      level: existing?.origin ? existing.level : "unavailable",
      source: existing?.source ?? "Open Facts (ingredienti)",
      percentEstimate: ing.percentEstimate,
    });
  }

  // --- OCR ---
  const ocrText = ocr?.rawText ?? "";
  const ocrClaims = [
    ...parseOriginsFromText(ocrText),
    ...expandLegacyOriginClaims(ocr?.originClaims ?? []),
  ];

  for (const claim of ocrClaims) {
    if (claim.type === "ingredient" && claim.ingredient) {
      addIngredientOrigin(claim.ingredient, claim.place, "verified", "OCR etichetta");
      continue;
    }
    const label =
      claim.type === "manufacturing" ? "Produzione / confezionamento (OCR)" : "Origine prodotto (OCR)";
    const duplicate = items.some((i) => i.label === label && i.value?.includes(claim.place));
    if (!duplicate) {
      items.push({
        label,
        value: claim.place,
        level: "verified",
        source: "OCR etichetta",
      });
    }
  }

  // --- Ingredienti OCR (lista senza origine per ingrediente) ---
  const hasIngredients =
    Boolean(offProduct?.ingredients_text?.trim()) || Boolean(ocr?.ingredients?.trim());
  items.push({
    label: "Lista ingredienti",
    value: offProduct?.ingredients_text ?? ocr?.ingredients,
    level: hasIngredients ? (offProduct?.ingredients_text ? "partial" : "verified") : "unavailable",
    source: offProduct?.ingredients_text
      ? "Open Facts"
      : ocr?.ingredients
        ? "OCR etichetta"
        : undefined,
  });

  // --- Dogana ---
  if (customs?.hsCode) {
    items.push({
      label: "Codice doganale (HS)",
      value: `${customs.hsCode}${customs.country ? ` · ${customs.country}` : ""}`,
      level: customs.source === "un_comtrade" ? "partial" : "partial",
      source: customs.source === "un_comtrade" ? "UN Comtrade" : "Inferenza da categoria",
    });
  }

  ingredientOrigins.push(...ingredientOriginMap.values());

  const hasIngredientOrigins = ingredientOrigins.some((i) => i.origin);
  const hasGeo = items.some(
    (i) =>
      i.level !== "unavailable" &&
      !i.label.startsWith("Lista ingredienti") &&
      !i.label.startsWith("Codice doganale"),
  );

  let overallLevel: TraceLevel = "unavailable";
  if (hasIngredientOrigins && hasGeo) overallLevel = "verified";
  else if (hasIngredientOrigins || hasGeo || hasIngredients) overallLevel = "partial";

  const summary =
    overallLevel === "verified"
      ? "Filiera parzialmente tracciabile: presenti origini specifiche e dati geografici."
      : overallLevel === "partial"
        ? "Dati filiera incompleti: ingredienti o geografia generica, origini per singolo ingrediente limitate."
        : "Filiera non tracciabile: mancano origini e dati geografici affidabili.";

  return { items, ingredientOrigins, overallLevel, summary };
}
