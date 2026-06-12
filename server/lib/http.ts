import { serverConfig } from "../config";

export async function fetchJson<T>(
  url: string,
  init?: RequestInit & { timeoutMs?: number },
): Promise<{ ok: boolean; status: number; data: T | null; error?: string }> {
  const timeoutMs = init?.timeoutMs ?? serverConfig.requestTimeoutMs;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const response = await fetch(url, {
      ...init,
      signal: controller.signal,
      headers: {
        "User-Agent": serverConfig.userAgent,
        Accept: "application/json",
        ...(init?.headers ?? {}),
      },
    });

    if (!response.ok) {
      return { ok: false, status: response.status, data: null, error: `HTTP ${response.status}` };
    }

    const data = (await response.json()) as T;
    return { ok: true, status: response.status, data };
  } catch (err) {
    const message = err instanceof Error ? err.message : "Errore di rete";
    return { ok: false, status: 0, data: null, error: message };
  } finally {
    clearTimeout(timer);
  }
}
