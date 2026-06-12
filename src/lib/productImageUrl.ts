/** URL immagine prodotto via proxy API (evita 403 da hotlink protection) */
export function proxiedProductImageUrl(url?: string): string | undefined {
  if (!url?.trim()) return undefined;
  try {
    const parsed = new URL(url.trim());
    if (parsed.protocol !== "https:" && parsed.protocol !== "http:") return undefined;
    return `/api/image/proxy?url=${encodeURIComponent(parsed.href)}`;
  } catch {
    return undefined;
  }
}
