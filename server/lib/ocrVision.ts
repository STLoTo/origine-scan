import { serverConfig } from "../config";
import {
  chatCompletion,
  isInfomaniakConfigured,
  type ChatContentPart,
} from "./infomaniakClient";
import { extractBarcode, inferHintsFromRawText } from "./ocrHints";
import type { OcrExtraction } from "../types/evidence";

export { checkInfomaniakVisionAvailable } from "./infomaniakClient";

const VISION_PROMPT =
  "Trascrivi fedelmente tutto il testo visibile in questa etichetta alimentare. " +
  "Includi: nome prodotto, marca, ingredienti, allergeni, codice a barre/EAN, peso netto, " +
  "certificazioni (bio, vegan, DOP, IGP, ecc.) e origine (prodotto in / made in). " +
  "Mantieni l'ordine e le righe originali. " +
  "Restituisci SOLO il testo trascritto, senza commenti né markdown.";

function extractField(text: string, patterns: RegExp[]): string | undefined {
  for (const re of patterns) {
    const m = text.match(re);
    if (m?.[1]?.trim()) return m[1].trim();
  }
  return undefined;
}

function enrichFromRawText(rawText: string): Partial<OcrExtraction> {
  const hints = inferHintsFromRawText(rawText);
  const lower = rawText.toLowerCase();

  const ingredients = extractField(rawText, [
    /ingredienti\s*:?\s*([\s\S]{10,800}?)(?:\n\n|\n(?:allergeni|contiene|conservare|netto)|$)/i,
    /ingredients\s*:?\s*([\s\S]{10,800}?)(?:\n\n|\n(?:allergens|contains)|$)/i,
  ]);

  const labelClaims: string[] = [];
  for (const kw of ["bio", "organic", "vegan", "gluten free", "senza glutine", "fair trade", "dop", "igp"]) {
    if (lower.includes(kw)) labelClaims.push(kw);
  }

  const originClaims: string[] = [];
  const originMatch = rawText.match(
    /(?:prodotto in|made in|origine|fabbricato in)\s*:?\s*([^\n,;]+)/gi,
  );
  if (originMatch) originClaims.push(...originMatch.map((s) => s.trim()));

  return {
    rawText,
    productName: hints.productName,
    brand: hints.brand,
    ingredients,
    labelClaims,
    originClaims,
  };
}

function cleanOcrOutput(text: string): string {
  return text
    .replace(/```+[\s\S]*?```+/g, "")
    .replace(/```+/g, "")
    .replace(/^---+\s*$/gm, "")
    .split("\n")
    .filter((line, i, arr) => i === 0 || line.trim() !== arr[i - 1]?.trim())
    .join("\n")
    .trim();
}

function visionMessage(base64: string, mimeType: string): ChatContentPart[] {
  return [
    { type: "text", text: VISION_PROMPT },
    {
      type: "image_url",
      image_url: { url: `data:${mimeType};base64,${base64}` },
    },
  ];
}

async function runVisionOcr(model: string, base64: string, mimeType: string): Promise<string> {
  const content = await chatCompletion({
    model,
    temperature: 0.1,
    maxCompletionTokens: 2048,
    messages: [{ role: "user", content: visionMessage(base64, mimeType) }],
  });
  return cleanOcrOutput(content);
}

/** OCR etichetta via Infomaniak vision (chat multimodale) */
export async function extractTextFromImage(
  imageBuffer: Buffer,
  mimeType = "image/jpeg",
): Promise<OcrExtraction> {
  if (!isInfomaniakConfigured()) {
    throw new Error(
      "Infomaniak API non configurata. Imposta INFOMANIAK_API_TOKEN e INFOMANIAK_PRODUCT_ID nel .env",
    );
  }

  const allowed = ["image/jpeg", "image/png", "image/webp"];
  if (!allowed.includes(mimeType)) {
    throw new Error(
      `Formato ${mimeType} non supportato. Usa JPEG, PNG o WebP (no HEIC).`,
    );
  }

  if (imageBuffer.length > 8 * 1024 * 1024) {
    throw new Error("Immagine troppo grande (max 8 MB). Riprova con foto più leggera.");
  }

  const base64 = imageBuffer.toString("base64");
  const primary = serverConfig.infomaniakVisionModel;
  const fallback = serverConfig.infomaniakVisionFallbackModel;

  let rawText = "";
  let usedModel = primary;

  try {
    rawText = await runVisionOcr(primary, base64, mimeType);
    if (!rawText.trim() && fallback && fallback !== primary) {
      rawText = await runVisionOcr(fallback, base64, mimeType);
      usedModel = fallback;
    }
  } catch (primaryErr) {
    if (!fallback || fallback === primary) throw primaryErr;
    rawText = await runVisionOcr(fallback, base64, mimeType);
    usedModel = fallback;
  }

  if (!rawText.trim()) {
    throw new Error("OCR non ha estratto testo. Prova con foto più nitida e ben illuminata.");
  }

  const enriched = enrichFromRawText(rawText);

  return {
    rawText: enriched.rawText ?? rawText,
    barcode: extractBarcode(rawText),
    productName: enriched.productName,
    brand: enriched.brand,
    ingredients: enriched.ingredients,
    originClaims: enriched.originClaims ?? [],
    labelClaims: enriched.labelClaims ?? [],
    provider: "infomaniak",
    model: usedModel,
  };
}
