import { serverConfig } from "../config";
import {
  chatCompletion,
  isInfomaniakConfigured,
  type ChatContentPart,
} from "./infomaniakClient";
import { extractBarcode, inferHintsFromRawText } from "./ocrHints";
import { analyzeOcrText } from "./ocrTextAnalysis";
import type { OcrExtraction } from "../types/evidence";

export { checkInfomaniakVisionAvailable } from "./infomaniakClient";

const VISION_PROMPT =
  "Trascrivi fedelmente tutto il testo visibile su questa etichetta (alimentare, cosmetica o detergente). " +
  "Includi: nome prodotto, marca, ingredienti/INCI, allergeni, avvertenze di sicurezza, codice EAN/barcode, peso netto, " +
  "certificazioni e origine se presenti. " +
  "NON inventare ingredienti o varianti chimiche: trascrivi solo ciò che è leggibile. " +
  "Mantieni l'ordine e le righe originali. " +
  "Restituisci SOLO il testo trascritto, senza commenti né markdown.";

function enrichFromRawText(rawText: string): Partial<OcrExtraction> {
  const analysis = analyzeOcrText(rawText);
  const text = analysis.cleanedText;
  const hints = inferHintsFromRawText(text);
  const lower = text.toLowerCase();

  const labelClaims: string[] = [];
  for (const kw of ["bio", "organic", "vegan", "gluten free", "senza glutine", "fair trade", "dop", "igp"]) {
    if (lower.includes(kw)) labelClaims.push(kw);
  }

  const originClaims: string[] = [];
  const originMatch = text.match(
    /(?:prodotto in|made in|origine|fabbricato in)\s*:?\s*([^\n,;]+)/gi,
  );
  if (originMatch) originClaims.push(...originMatch.map((s) => s.trim()));

  return {
    rawText: text,
    productName: hints.productName,
    brand: hints.brand,
    ingredients: analysis.ingredients,
    labelKind: analysis.labelKind,
    warnings: analysis.warnings.length ? analysis.warnings : undefined,
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
    labelKind: enriched.labelKind,
    warnings: enriched.warnings,
    originClaims: enriched.originClaims ?? [],
    labelClaims: enriched.labelClaims ?? [],
    provider: "infomaniak",
    model: usedModel,
  };
}
