import { serverConfig } from "../config";
import { fetchJson } from "../lib/http";

interface SerpShoppingResponse {
  shopping_results?: Array<{
    title?: string;
    source?: string;
    price?: string;
    extracted_price?: number;
    link?: string;
  }>;
  error?: string;
}

export async function searchShopping(
  query: string,
  barcode?: string,
): Promise<Record<string, unknown>> {
  if (!serverConfig.serpApiKey) {
    return {
      shopping_results: [],
      note: "SERP_API_KEY non configurata — configurare in .env per risultati reali",
    };
  }

  const q = barcode ? `${query} ${barcode}` : query;
  const url = `https://serpapi.com/search.json?engine=google_shopping&q=${encodeURIComponent(q)}&api_key=${serverConfig.serpApiKey}&gl=it&hl=it`;
  const result = await fetchJson<SerpShoppingResponse>(url);

  if (!result.ok || !result.data) {
    return { shopping_results: [], error: result.error };
  }

  const shopping_results = (result.data.shopping_results ?? []).slice(0, 5).map((r) => ({
    title: r.title,
    seller: r.source,
    price: r.price,
    link: r.link,
    origin_note: extractOriginFromTitle(r.title),
  }));

  return { shopping_results, source: "serpapi" };
}

function extractOriginFromTitle(title?: string): string | undefined {
  if (!title) return undefined;
  const match = title.match(/made in\s+([a-zA-Z\s]+)/i);
  return match ? match[1].trim() : undefined;
}
