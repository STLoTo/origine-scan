import { serverConfig } from "../config";

export type ChatContentPart =
  | { type: "text"; text: string }
  | { type: "image_url"; image_url: { url: string } };

export type ChatMessage = {
  role: "system" | "user" | "assistant";
  content: string | ChatContentPart[];
};

export function isInfomaniakConfigured(): boolean {
  return Boolean(serverConfig.infomaniakApiToken && serverConfig.infomaniakProductId);
}

function baseUrl(): string {
  return `${serverConfig.infomaniakBaseUrl}/2/ai/${serverConfig.infomaniakProductId}/openai/v1`;
}

export async function readInfomaniakError(res: Response): Promise<string> {
  try {
    const body = (await res.json()) as {
      error?: { message?: string } | string;
      message?: string;
    };
    if (typeof body.error === "string") return body.error;
    if (body.error && typeof body.error === "object" && body.error.message) {
      return body.error.message;
    }
    return body.message ?? res.statusText;
  } catch {
    return res.statusText;
  }
}

export async function chatCompletion(options: {
  model: string;
  messages: ChatMessage[];
  temperature?: number;
  maxCompletionTokens?: number;
}): Promise<string> {
  if (!isInfomaniakConfigured()) {
    throw new Error("Infomaniak API non configurata (INFOMANIAK_API_TOKEN, INFOMANIAK_PRODUCT_ID)");
  }

  const res = await fetch(`${baseUrl()}/chat/completions`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${serverConfig.infomaniakApiToken}`,
    },
    signal: AbortSignal.timeout(serverConfig.llmTimeoutMs),
    body: JSON.stringify({
      model: options.model,
      messages: options.messages,
      stream: false,
      temperature: options.temperature ?? 0.3,
      max_completion_tokens: options.maxCompletionTokens,
    }),
  });

  if (!res.ok) {
    const detail = await readInfomaniakError(res);
    throw new Error(`Infomaniak HTTP ${res.status}: ${detail}`);
  }

  const data = (await res.json()) as {
    choices?: { message?: { content?: string } }[];
  };
  return data.choices?.[0]?.message?.content ?? "";
}

export async function listModelIds(): Promise<string[]> {
  if (!isInfomaniakConfigured()) return [];

  const res = await fetch(`${baseUrl()}/models`, {
    headers: { Authorization: `Bearer ${serverConfig.infomaniakApiToken}` },
    signal: AbortSignal.timeout(5000),
  });
  if (!res.ok) return [];

  const data = (await res.json()) as { data?: { id: string }[] | { id: string } };
  const items = Array.isArray(data.data) ? data.data : data.data ? [data.data] : [];
  return items.map((m) => m.id).filter(Boolean);
}

function modelAvailable(ids: string[], model: string): boolean {
  if (!model) return false;
  if (ids.includes(model)) return true;
  const base = model.split("/").pop()?.split(":")[0] ?? model;
  return ids.some((id) => id === model || id.includes(base) || id.endsWith(base));
}

export async function checkInfomaniakAvailable(): Promise<boolean> {
  if (!isInfomaniakConfigured()) return false;
  try {
    const ids = await listModelIds();
    return ids.length > 0;
  } catch {
    return false;
  }
}

export async function checkInfomaniakLlmAvailable(): Promise<boolean> {
  if (!isInfomaniakConfigured()) return false;
  try {
    const ids = await listModelIds();
    return modelAvailable(ids, serverConfig.infomaniakLlmModel);
  } catch {
    return false;
  }
}

export async function checkInfomaniakVisionAvailable(): Promise<boolean> {
  if (!isInfomaniakConfigured()) return false;
  try {
    const ids = await listModelIds();
    const primary = modelAvailable(ids, serverConfig.infomaniakVisionModel);
    const fallback = serverConfig.infomaniakVisionFallbackModel
      ? modelAvailable(ids, serverConfig.infomaniakVisionFallbackModel)
      : false;
    return primary || fallback;
  } catch {
    return false;
  }
}
