import { serverConfig } from "../config";
import { fetchJson } from "../lib/http";
import type { FlatOpenProduct } from "../lib/openFactsClient";

const CATEGORY_HS_MAP: Record<string, string> = {
  "olive oils": "1509.10",
  olive: "1509.10",
  cosmetics: "3304.99",
  beauty: "3304.99",
  headphones: "8518.30",
  electronics: "8517.62",
  "t-shirts": "6109.10",
  textiles: "6109.10",
  apparel: "6109.10",
  jeans: "6203.42",
  denim: "6203.42",
  footwear: "6404.11",
  sneakers: "6404.11",
  jackets: "6201.93",
  socks: "6115.95",
  hosiery: "6115.95",
  hoodies: "6110.20",
  dresses: "6204.44",
  linen: "6204.44",
  snacks: "1904.10",
  biscuits: "1905.31",
  "cocoa and hazelnuts spreads": "1806.90",
  "hazelnuts spreads": "1806.90",
  "chocolate spreads": "1806.90",
  spreads: "1806.90",
  bread: "1905.90",
  "cleaning products": "3402.20",
  "laundry detergents": "3402.20",
  "dishwashing": "3402.20",
  detergents: "3402.20",
  "household cleaners": "3402.90",
  "fabric softeners": "3809.10",
  "floor cleaners": "3402.90",
  "toilet paper": "4818.10",
  "paper products": "4818.10",
  soap: "3401.30",
};

function inferHsCode(categories?: string): string | undefined {
  if (!categories) return undefined;
  const lower = categories.toLowerCase();
  for (const [key, hs] of Object.entries(CATEGORY_HS_MAP)) {
    if (lower.includes(key)) return hs;
  }
  return undefined;
}

function inferImportCountry(openProduct?: FlatOpenProduct | null): string | undefined {
  // Stringhe vuote da OFF non devono bloccare countries/origins
  for (const field of [
    openProduct?.manufacturing_places,
    openProduct?.origins,
    openProduct?.countries,
  ]) {
    const trimmed = field?.trim();
    if (trimmed) return trimmed.split(",")[0]?.trim();
  }
  return undefined;
}

/** Dati doganali: UN Comtrade se API key presente, altrimenti inferenza da categorie */
export async function lookupCustoms(
  openProduct?: FlatOpenProduct | null,
  barcode?: string,
): Promise<Record<string, unknown>> {
  const hs_code = inferHsCode(openProduct?.categories);
  const last_import_country = inferImportCountry(openProduct);

  if (serverConfig.unComtradeApiKey && hs_code) {
    const url = `https://comtradeapi.un.org/data/v1/get/C/A/HS?reporterCode=380&period=2024&cmdCode=${hs_code.replace(".", "")}&partnerCode=0&flowCode=M&subscription-key=${serverConfig.unComtradeApiKey}`;
    const result = await fetchJson<{ data?: unknown[] }>(url, { timeoutMs: 15000 });

    if (result.ok && result.data?.data?.length) {
      return {
        hs_code,
        last_import_country,
        granularity: "country",
        trade_records: result.data.data.length,
        source: "un_comtrade",
        barcode,
      };
    }
  }

  if (!hs_code && !last_import_country) {
    return { granularity: "low", note: "Nessun dato doganale inferibile" };
  }

  return {
    hs_code,
    last_import_country,
    granularity: hs_code ? "country" : "low",
    source: "inferred_from_open_facts",
    note: serverConfig.unComtradeApiKey
      ? "Comtrade senza risultati — usata inferenza"
      : "UN_COMTRADE_API_KEY assente — inferenza da categorie Open Facts",
  };
}
