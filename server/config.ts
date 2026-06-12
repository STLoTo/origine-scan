import "dotenv/config";

export const serverConfig = {
  port: Number(process.env.PORT ?? 3001),
  serpApiKey: process.env.SERP_API_KEY ?? "",
  unComtradeApiKey: process.env.UN_COMTRADE_API_KEY ?? "",
  requestTimeoutMs: Number(process.env.REQUEST_TIMEOUT_MS ?? 12000),
  userAgent: "OrigineScan/0.4 (product-evidence)",

  aiProvider: (process.env.AI_PROVIDER ?? "ollama") as "ollama" | "openai" | "none",
  ollamaBaseUrl: process.env.OLLAMA_BASE_URL ?? "http://localhost:11434",
  ollamaModel: process.env.OLLAMA_MODEL ?? "llama3.2:latest",
  ollamaOcrModel: process.env.OLLAMA_OCR_MODEL ?? "glm-ocr:latest",
  ollamaOcrFallbackModel: process.env.OLLAMA_OCR_FALLBACK_MODEL ?? "qwen3.5:4b",
  openAiApiKey: process.env.OPENAI_API_KEY ?? "",
  openAiModel: process.env.OPENAI_MODEL ?? "gpt-4o-mini",
  llmTimeoutMs: Number(process.env.LLM_TIMEOUT_MS ?? 90000),
};
