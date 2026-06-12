import { serverConfig } from "../config";
import type { OcrExtraction } from "../types/evidence";

/** Prompt ufficiale GLM-OCR — non usare JSON nel prompt vision */
const GLM_OCR_PROMPT = "Text Recognition:";

const VISION_CHAT_PROMPT =
  "Leggi tutto il testo visibile in questa etichetta prodotto. " +
  "Restituisci solo il testo letto, riga per riga, senza commenti.";

function isSpecialistOcrModel(model: string): boolean {
  const base = model.split(":")[0].toLowerCase();
  return base.includes("glm-ocr") || base.includes("deepseek-ocr");
}

function extractBarcode(text: string): string | undefined {
  const matches = text.match(/\b(\d{8}|\d{12,14})\b/g);
  if (!matches) return undefined;
  return matches.find((m) => m.length === 13) ?? matches[matches.length - 1];
}

function extractField(text: string, patterns: RegExp[]): string | undefined {
  for (const re of patterns) {
    const m = text.match(re);
    if (m?.[1]?.trim()) return m[1].trim();
  }
  return undefined;
}

/** Estrae metadati dal testo OCR grezzo (post-processing locale) */
function enrichFromRawText(rawText: string): Partial<OcrExtraction> {
  const lower = rawText.toLowerCase();
  const productName = extractField(rawText, [
    /(?:^|\n)([A-ZÀ-Ü][A-Za-zÀ-ü0-9\s'&.-]{2,60})(?:\n|$)/,
  ]);

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
    productName,
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

async function readOllamaError(res: Response): Promise<string> {
  try {
    const body = (await res.json()) as { error?: string };
    return body.error ?? res.statusText;
  } catch {
    return res.statusText;
  }
}

/** glm-ocr / deepseek-ocr: endpoint nativo /api/generate */
async function ollamaGenerateOcr(model: string, base64: string): Promise<string> {
  const res = await fetch(`${serverConfig.ollamaBaseUrl}/api/generate`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    signal: AbortSignal.timeout(serverConfig.llmTimeoutMs),
    body: JSON.stringify({
      model,
      prompt: GLM_OCR_PROMPT,
      images: [base64],
      stream: false,
      options: {
        num_predict: 2048,
        temperature: 0.1,
      },
    }),
  });

  if (!res.ok) {
    const detail = await readOllamaError(res);
    throw new Error(`Ollama generate ${res.status}: ${detail}`);
  }

  const data = (await res.json()) as { response?: string };
  return cleanOcrOutput(data.response ?? "");
}

/** Modelli vision generici (qwen, llava…): /api/chat */
async function ollamaChatVision(model: string, base64: string): Promise<string> {
  const res = await fetch(`${serverConfig.ollamaBaseUrl}/api/chat`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    signal: AbortSignal.timeout(serverConfig.llmTimeoutMs),
    body: JSON.stringify({
      model,
      stream: false,
      messages: [
        {
          role: "user",
          content: VISION_CHAT_PROMPT,
          images: [base64],
        },
      ],
    }),
  });

  if (!res.ok) {
    const detail = await readOllamaError(res);
    throw new Error(`Ollama chat ${res.status}: ${detail}`);
  }

  const data = (await res.json()) as { message?: { content?: string } };
  return cleanOcrOutput(data.message?.content ?? "");
}

async function runOcrWithModel(model: string, base64: string): Promise<string> {
  if (isSpecialistOcrModel(model)) {
    return ollamaGenerateOcr(model, base64);
  }
  return ollamaChatVision(model, base64);
}

/** OCR etichetta via Ollama vision */
export async function extractTextFromImage(
  imageBuffer: Buffer,
  mimeType = "image/jpeg",
): Promise<OcrExtraction> {
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
  const primary = serverConfig.ollamaOcrModel;
  const fallback = serverConfig.ollamaOcrFallbackModel;

  let rawText = "";
  let usedModel = primary;

  try {
    rawText = await runOcrWithModel(primary, base64);
    if (!rawText.trim() && fallback && fallback !== primary) {
      rawText = await runOcrWithModel(fallback, base64);
      usedModel = fallback;
    }
  } catch (primaryErr) {
    if (!fallback || fallback === primary) throw primaryErr;
    rawText = await runOcrWithModel(fallback, base64);
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
    provider: "ollama",
    model: usedModel,
  };
}

export async function checkOllamaOcrAvailable(): Promise<boolean> {
  try {
    const res = await fetch(`${serverConfig.ollamaBaseUrl}/api/tags`, {
      signal: AbortSignal.timeout(3000),
    });
    if (!res.ok) return false;
    const data = (await res.json()) as { models?: { name: string }[] };
    const names = data.models?.map((m) => m.name) ?? [];
    const has = (model: string) => {
      const base = model.split(":")[0];
      return names.some((n) => n.startsWith(base));
    };
    return has(serverConfig.ollamaOcrModel) || has(serverConfig.ollamaOcrFallbackModel);
  } catch {
    return false;
  }
}
