import { fetchJson } from "../lib/http";

interface UpcItemDbResponse {
  items?: Array<{
    title?: string;
    brand?: string;
    description?: string;
    company?: string;
    category?: string;
  }>;
}

/** Lookup GTIN via UPCitemdb (trial) — proxy verso dati pubblici barcode */
export async function lookupGs1(barcode: string): Promise<Record<string, unknown>> {
  const url = `https://api.upcitemdb.com/prod/trial/lookup?upc=${encodeURIComponent(barcode)}`;
  const result = await fetchJson<UpcItemDbResponse>(url, { timeoutMs: 15000 });

  if (!result.ok) {
    return {
      gtin: barcode,
      source: "upcitemdb_trial",
      error: result.error ?? `HTTP ${result.status}`,
      note: "UPCitemdb non raggiungibile o rate limit trial",
    };
  }

  if (!result.data?.items?.length) {
    return {
      gtin: barcode,
      source: "upcitemdb_trial",
      note: "Nessun match per questo barcode",
    };
  }

  const item = result.data.items[0];
  return {
    gtin: barcode,
    company_name: item.company ?? item.brand ?? undefined,
    product_description: item.title ?? item.description,
    verified: false,
    source: "upcitemdb_trial",
    note: "Dati barcode pubblici — non Verified by GS1 ufficiale",
  };
}
