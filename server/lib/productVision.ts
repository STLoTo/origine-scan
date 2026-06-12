import { serverConfig } from "../config";
import {
  chatCompletion,
  isInfomaniakConfigured,
  type ChatContentPart,
} from "./infomaniakClient";
import type { ProductVision } from "../types/evidence";

const MAX_IMAGES = 5;

const PRODUCT_VISION_PROMPT =
  "Analizza queste foto di un prodotto alimentare o di consumo (confezione, fronte, retro, dettagli). " +
  "Identifica tipo di prodotto, marca e nome se visibili, categoria e caratteristiche utili al riconoscimento. " +
  "Rispondi SOLO con JSON valido, senza markdown:\n" +
  '{"productName":"nome o null","brand":"marca o null","category":"categoria o null",' +
  '"description":"2-4 frasi in italiano","visualCues":["indizio visivo 1","indizio 2"]}';

function parseProductVision(content: string, model: string): ProductVision {
  const jsonMatch = content.match(/\{[\s\S]*\}/);
  if (!jsonMatch) {
    return {
      description: content.trim().slice(0, 600) || "Prodotto non identificato dalle foto.",
      visualCues: [],
      provider: "infomaniak",
      model,
    };
  }

  try {
    const p = JSON.parse(jsonMatch[0]) as Record<string, unknown>;
    const str = (v: unknown) => {
      const s = String(v ?? "").trim();
      return s && s.toLowerCase() !== "null" ? s : undefined;
    };
    const visualCues = Array.isArray(p.visualCues)
      ? p.visualCues.map((c) => String(c).trim()).filter(Boolean)
      : [];

    return {
      productName: str(p.productName),
      brand: str(p.brand),
      category: str(p.category),
      description: str(p.description) ?? "Prodotto analizzato dalle foto.",
      visualCues,
      provider: "infomaniak",
      model,
    };
  } catch {
    return {
      description: content.trim().slice(0, 600),
      visualCues: [],
      provider: "infomaniak",
      model,
    };
  }
}

function buildVisionMessage(images: { base64: string; mimeType: string }[]): ChatContentPart[] {
  const parts: ChatContentPart[] = [{ type: "text", text: PRODUCT_VISION_PROMPT }];
  for (const img of images) {
    parts.push({
      type: "image_url",
      image_url: { url: `data:${img.mimeType};base64,${img.base64}` },
    });
  }
  return parts;
}

/** Analisi visiva prodotto da una o più foto (non OCR etichetta) */
export async function describeProductFromImages(
  buffers: { buffer: Buffer; mimeType: string }[],
): Promise<ProductVision> {
  if (!isInfomaniakConfigured()) {
    throw new Error(
      "Infomaniak API non configurata. Imposta INFOMANIAK_API_TOKEN e INFOMANIAK_PRODUCT_ID nel .env",
    );
  }

  if (!buffers.length) {
    throw new Error("Nessuna immagine prodotto fornita");
  }

  const allowed = ["image/jpeg", "image/png", "image/webp"];
  const images = buffers.slice(0, MAX_IMAGES).map(({ buffer, mimeType }) => {
    if (!allowed.includes(mimeType)) {
      throw new Error(`Formato ${mimeType} non supportato. Usa JPEG, PNG o WebP.`);
    }
    if (buffer.length > 8 * 1024 * 1024) {
      throw new Error("Immagine troppo grande (max 8 MB per foto).");
    }
    return { base64: buffer.toString("base64"), mimeType };
  });

  const primary = serverConfig.infomaniakVisionModel;
  const fallback = serverConfig.infomaniakVisionFallbackModel;
  let content = "";
  let usedModel = primary;

  try {
    content = await chatCompletion({
      model: primary,
      temperature: 0.2,
      maxCompletionTokens: 1024,
      messages: [{ role: "user", content: buildVisionMessage(images) }],
    });
    if (!content.trim() && fallback && fallback !== primary) {
      content = await chatCompletion({
        model: fallback,
        temperature: 0.2,
        maxCompletionTokens: 1024,
        messages: [{ role: "user", content: buildVisionMessage(images) }],
      });
      usedModel = fallback;
    }
  } catch (primaryErr) {
    if (!fallback || fallback === primary) throw primaryErr;
    content = await chatCompletion({
      model: fallback,
      temperature: 0.2,
      maxCompletionTokens: 1024,
      messages: [{ role: "user", content: buildVisionMessage(images) }],
    });
    usedModel = fallback;
  }

  return parseProductVision(content, usedModel);
}

export const maxProductImages = MAX_IMAGES;
