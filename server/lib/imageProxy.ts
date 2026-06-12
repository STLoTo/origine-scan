import { serverConfig } from "../config";

const ALLOWED_IMAGE_HOSTS = new Set([
  "images.openfoodfacts.org",
  "images.openbeautyfacts.org",
  "images.openproductsfacts.org",
  "static.openfoodfacts.org",
  "static.openbeautyfacts.org",
  "static.openproductsfacts.org",
  "world.openfoodfacts.org",
  "world.openbeautyfacts.org",
  "world.openproductsfacts.org",
]);

export function normalizeProductImageUrl(url?: string): string | undefined {
  if (!url?.trim()) return undefined;
  try {
    const parsed = new URL(url.trim());
    if (parsed.protocol !== "https:" && parsed.protocol !== "http:") return undefined;
    return parsed.href;
  } catch {
    return undefined;
  }
}

export function isAllowedProductImageUrl(url: string): boolean {
  try {
    const parsed = new URL(url);
    return ALLOWED_IMAGE_HOSTS.has(parsed.hostname);
  } catch {
    return false;
  }
}

/** Scarica immagine prodotto lato server (evita 403 hotlink nel browser) */
export async function fetchProductImage(
  url: string,
): Promise<{ ok: true; buffer: Buffer; contentType: string } | { ok: false; status: number }> {
  const res = await fetch(url, {
    headers: {
      "User-Agent": serverConfig.userAgent,
      Accept: "image/avif,image/webp,image/apng,image/*,*/*;q=0.8",
    },
    signal: AbortSignal.timeout(serverConfig.requestTimeoutMs),
    redirect: "follow",
  });

  if (!res.ok) {
    return { ok: false, status: res.status };
  }

  const contentType = res.headers.get("content-type") ?? "image/jpeg";
  if (!contentType.startsWith("image/")) {
    return { ok: false, status: 415 };
  }

  const buffer = Buffer.from(await res.arrayBuffer());
  return { ok: true, buffer, contentType };
}
