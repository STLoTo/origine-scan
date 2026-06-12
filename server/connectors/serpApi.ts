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

interface SerpWebResponse {
  organic_results?: Array<{
    title?: string;
    link?: string;
    snippet?: string;
    source?: string;
  }>;
  answer_box?: {
    title?: string;
    snippet?: string;
    link?: string;
  };
  knowledge_graph?: {
    title?: string;
    description?: string;
    source?: { name?: string; link?: string };
  };
  error?: string;
}

export interface WebSearchResult {
  query: string;
  organic_results: Array<{
    title?: string;
    link?: string;
    snippet?: string;
    source?: string;
  }>;
  answer_box?: {
    title?: string;
    snippet?: string;
    link?: string;
  };
  knowledge_graph?: {
    title?: string;
    description?: string;
    source?: string;
  };
  source: string;
  error?: string;
  note?: string;
}

/** Costruisce query web orientata a filiera / scheda prodotto */
export function buildWebSearchQuery(
  brand?: string,
  productName?: string,
  labelKind?: "food" | "cosmetic" | "cleaning" | "unknown",
): string {
  const base = [brand, productName].filter(Boolean).join(" ").trim();
  if (!base) return "";

  if (labelKind === "cleaning" || labelKind === "cosmetic") {
    return `${base} scheda prodotto ingredienti INCI`;
  }
  return `${base} prodotto origine filiera`;
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

/** Ricerca organica Google via SerpApi — arricchisce la sintesi AI */
export async function searchWeb(query: string, barcode?: string): Promise<WebSearchResult> {
  if (!serverConfig.serpApiKey) {
    return {
      query,
      organic_results: [],
      source: "serpapi",
      note: "SERP_API_KEY non configurata — configurare in .env per risultati reali",
    };
  }

  const q = barcode ? `${query} ${barcode}`.trim() : query.trim();
  if (!q) {
    return { query: q, organic_results: [], source: "serpapi", note: "Query vuota" };
  }

  const url =
    `https://serpapi.com/search.json?engine=google&q=${encodeURIComponent(q)}` +
    `&api_key=${serverConfig.serpApiKey}&gl=it&hl=it&num=5`;

  const result = await fetchJson<SerpWebResponse>(url);

  if (!result.ok || !result.data) {
    return {
      query: q,
      organic_results: [],
      source: "serpapi",
      error: result.error,
    };
  }

  const organic_results = (result.data.organic_results ?? []).slice(0, 5).map((r) => ({
    title: r.title,
    link: r.link,
    snippet: r.snippet,
    source: r.source,
  }));

  const answer_box = result.data.answer_box?.snippet
    ? {
        title: result.data.answer_box.title,
        snippet: result.data.answer_box.snippet,
        link: result.data.answer_box.link,
      }
    : undefined;

  const knowledge_graph = result.data.knowledge_graph
    ? {
        title: result.data.knowledge_graph.title,
        description: result.data.knowledge_graph.description,
        source: result.data.knowledge_graph.source?.name,
      }
    : undefined;

  return {
    query: q,
    organic_results,
    answer_box,
    knowledge_graph,
    source: "serpapi",
  };
}
