import type {
  AnalyzeResponse,
  DatabaseLamp,
  DatabasesStatusResponse,
  HealthResponse,
  OcrExtraction,
  ProductVision,
} from "../types/evidence";
import { DATABASE_CATALOG, defaultDatabaseLamps, mergeLampsFromEvidence, type DatabaseLampStatus } from "../lib/databaseCatalog";

const API = "/api";

/** Margine sotto il limite Vercel (~4.5MB) per upload multipart */
export const MAX_UPLOAD_TOTAL_BYTES = 3.5 * 1024 * 1024;

function apiErrorMessage(res: Response, data: { error?: string; hint?: string }): string {
  if (res.status === 403) {
    return (
      "Accesso negato (403). Su Vercel disattiva Deployment Protection per il dominio pubblico, " +
      "oppure riduci le foto e riprova."
    );
  }
  if (res.status === 413) {
    return "Payload troppo grande (413). Usa meno foto o immagini più leggere (max ~900KB ciascuna).";
  }
  return data.error ?? data.hint ?? `Errore API (${res.status})`;
}

async function parseJsonResponse<T>(res: Response): Promise<T> {
  const contentType = res.headers.get("content-type") ?? "";
  if (!contentType.includes("application/json")) {
    if (res.status === 403) {
      throw new Error(apiErrorMessage(res, {}));
    }
    throw new Error("API non raggiungibile (risposta non JSON — verifica deploy Vercel)");
  }
  return res.json() as Promise<T>;
}

async function ensureOk<T extends { error?: string; hint?: string }>(
  res: Response,
  data: T,
  fallback: string,
): Promise<void> {
  if (!res.ok) throw new Error(apiErrorMessage(res, data) || fallback);
}

export async function fetchHealth(): Promise<HealthResponse> {
  const res = await fetch(`${API}/health`);
  if (!res.ok) throw new Error("API non raggiungibile");
  return parseJsonResponse<HealthResponse>(res);
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
  if (!res.ok) throw new Error("Stato banche dati non disponibile");
  const data = await parseJsonResponse<DatabasesStatusResponse>(res);
  return data.databases ?? [];
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
  const data = await parseJsonResponse<{ ocr: OcrExtraction; error?: string; hint?: string }>(res);
  await ensureOk(res, data, "Errore OCR");
  return data.ocr;
}

export async function analyzeProductVision(images: File[]): Promise<ProductVision> {
  const form = new FormData();
  for (const img of images) {
    form.append("productImages", img);
  }

  const res = await fetch(`${API}/product/vision`, { method: "POST", body: form });
  const data = await parseJsonResponse<{ productVision: ProductVision; error?: string }>(res);
  await ensureOk(res, data, "Errore vision prodotto");
  return data.productVision;
}

async function analyzePayload(body: {
  ocr?: OcrExtraction | null;
  productVision?: ProductVision;
  barcode?: string;
  productName?: string;
  brand?: string;
}): Promise<AnalyzeResponse> {
  const res = await fetch(`${API}/analyze/json`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      ocr: body.ocr ?? undefined,
      productVision: body.productVision,
      barcode: body.barcode?.trim() || body.ocr?.barcode,
      productName: body.productName?.trim() || body.ocr?.productName || body.productVision?.productName,
      brand: body.brand?.trim() || body.ocr?.brand || body.productVision?.brand,
    }),
  });
  const data = await parseJsonResponse<AnalyzeResponse & { error?: string }>(res);
  await ensureOk(res, data, "Errore analisi");
  return data;
}

export const MAX_PRODUCT_PHOTOS = 5;

/** Pipeline consigliata su Vercel: OCR e vision separati, analisi via JSON */
export async function runFullAnalysis(options: {
  labelFile?: File | null;
  productFiles?: File[];
  ocr?: OcrExtraction | null;
  barcode?: string;
}): Promise<AnalyzeResponse> {
  let ocr = options.ocr ?? null;

  if (options.labelFile && !ocr) {
    ocr = await ocrLabel(options.labelFile);
  }

  let productVision: ProductVision | undefined;
  if (options.productFiles?.length) {
    productVision = await analyzeProductVision(options.productFiles);
  }

  return analyzePayload({
    ocr,
    productVision,
    barcode: options.barcode,
  });
}

/** @deprecated Preferire runFullAnalysis su Vercel */
export async function analyzeImage(
  image: File | null,
  extras?: {
    barcode?: string;
    productName?: string;
    brand?: string;
    productImages?: File[];
  },
): Promise<AnalyzeResponse> {
  return runFullAnalysis({
    labelFile: image,
    productFiles: extras?.productImages,
    barcode: extras?.barcode,
  });
}

export async function analyzeBarcode(barcode: string): Promise<AnalyzeResponse> {
  const res = await fetch(`${API}/analyze/barcode`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ barcode }),
  });
  const data = await parseJsonResponse<AnalyzeResponse & { error?: string }>(res);
  await ensureOk(res, data, "Errore analisi");
  return data;
}

export async function analyzeFromOcr(
  ocr: OcrExtraction,
  barcode?: string,
): Promise<AnalyzeResponse> {
  return analyzePayload({ ocr, barcode });
}

export function assertUploadBudget(files: File[]): void {
  const total = files.reduce((sum, f) => sum + f.size, 0);
  if (total > MAX_UPLOAD_TOTAL_BYTES) {
    const mb = (total / (1024 * 1024)).toFixed(1);
    throw new Error(
      `Foto troppo pesanti (${mb} MB). Su Vercel il limite è ~4.5 MB: rimuovi qualche foto o scatta con risoluzione minore.`,
    );
  }
}
