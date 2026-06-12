import type { AnalyzeResponse, DatabaseLamp, DatabasesStatusResponse, HealthResponse, OcrExtraction } from "../types/evidence";
import { DATABASE_CATALOG, mergeLampsFromEvidence, type DatabaseLampStatus } from "../lib/databaseCatalog";

const API = "/api";

export async function fetchHealth(): Promise<HealthResponse> {
  const res = await fetch(`${API}/health`);
  if (!res.ok) throw new Error("API non raggiungibile");
  return res.json();
}

/** Preferisce /health (include databases) per evitare 404 su server vecchi */
export async function fetchDatabasesStatus(): Promise<DatabaseLamp[]> {
  try {
    const health = await fetchHealth();
    if (health.databases?.length) return health.databases;
  } catch {
    /* prova route dedicata */
  }

  const res = await fetch(`${API}/databases/status`);
  if (!res.ok) return [];
  const data: DatabasesStatusResponse = await res.json();
  return data.databases;
}

export function lampsForAnalyzeStep(): DatabaseLamp[] {
  return DATABASE_CATALOG.map((d) => ({
    id: d.id,
    status: d.id === "serp_api" ? ("not_configured" as DatabaseLampStatus) : ("loading" as DatabaseLampStatus),
  }));
}

export { mergeLampsFromEvidence };

export async function ocrLabel(image: File): Promise<OcrExtraction> {
  const form = new FormData();
  form.append("image", image);

  const res = await fetch(`${API}/ocr/label`, { method: "POST", body: form });
  const data = await res.json();

  if (!res.ok) {
    throw new Error(data.error ?? data.hint ?? "Errore OCR");
  }

  return data.ocr;
}

export const MAX_PRODUCT_PHOTOS = 5;

export async function analyzeImage(
  image: File | null,
  extras?: {
    barcode?: string;
    productName?: string;
    brand?: string;
    productImages?: File[];
  },
): Promise<AnalyzeResponse> {
  const form = new FormData();
  if (image) form.append("image", image);
  if (extras?.barcode?.trim()) form.append("barcode", extras.barcode.trim());
  if (extras?.productName?.trim()) form.append("productName", extras.productName.trim());
  if (extras?.brand?.trim()) form.append("brand", extras.brand.trim());
  for (const img of extras?.productImages ?? []) {
    form.append("productImages", img);
  }

  const res = await fetch(`${API}/analyze`, { method: "POST", body: form });
  const data = await res.json();

  if (!res.ok) throw new Error(data.error ?? "Errore analisi");
  return data;
}

export async function analyzeBarcode(barcode: string): Promise<AnalyzeResponse> {
  const res = await fetch(`${API}/analyze/barcode`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ barcode }),
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data.error ?? "Errore analisi");
  return data;
}

export async function analyzeFromOcr(
  ocr: OcrExtraction,
  barcode?: string,
): Promise<AnalyzeResponse> {
  const form = new FormData();
  form.append("ocrText", ocr.rawText);
  if (barcode ?? ocr.barcode) form.append("barcode", barcode ?? ocr.barcode ?? "");
  if (ocr.productName) form.append("productName", ocr.productName);
  if (ocr.brand) form.append("brand", ocr.brand);
  if (ocr.ingredients) form.append("ingredients", ocr.ingredients);

  const res = await fetch(`${API}/analyze`, { method: "POST", body: form });
  const data = await res.json();
  if (!res.ok) throw new Error(data.error ?? "Errore analisi");
  return data;
}
