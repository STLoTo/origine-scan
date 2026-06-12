import "dotenv/config";

export const serverConfig = {
  port: Number(process.env.PORT ?? 3001),
  serpApiKey: process.env.SERP_API_KEY ?? "",
  unComtradeApiKey: process.env.UN_COMTRADE_API_KEY ?? "",
  requestTimeoutMs: Number(process.env.REQUEST_TIMEOUT_MS ?? 12000),
  userAgent: "OrigineScan/0.4 (product-evidence)",

  aiProvider: (process.env.AI_PROVIDER ?? "infomaniak") as "infomaniak" | "none",
  infomaniakApiToken: process.env.INFOMANIAK_API_TOKEN ?? "",
  infomaniakProductId: process.env.INFOMANIAK_PRODUCT_ID ?? "",
  infomaniakBaseUrl: process.env.INFOMANIAK_BASE_URL ?? "https://api.infomaniak.com",
  infomaniakLlmModel: process.env.INFOMANIAK_LLM_MODEL ?? "google/gemma-4-31B-it",
  /** Ministral 14B: multimodale, leggero, supporta IT — ideale per OCR etichette */
  infomaniakVisionModel:
    process.env.INFOMANIAK_VISION_MODEL ?? "mistralai/Ministral-3-14B-Instruct-2512",
  infomaniakVisionFallbackModel:
    process.env.INFOMANIAK_VISION_FALLBACK_MODEL ?? "Qwen/Qwen3.5-122B-A10B-FP8",
  llmTimeoutMs: Number(process.env.LLM_TIMEOUT_MS ?? 90000),
};
