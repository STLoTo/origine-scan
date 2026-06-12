import { extractCertifications } from "../connectors/certifications";
import { lookupCustoms } from "../connectors/customs";
import { lookupGs1 } from "../connectors/gs1";
import { searchShopping } from "../connectors/serpApi";
import { serverConfig } from "../config";
import { fetchUniversalProduct, searchProductByName } from "../lib/openFactsClient";
import type {
  OcrExtraction,
  ProductEvidence,
  SourceEvidence,
  SourceStatus,
} from "../types/evidence";

function splitList(value?: string): string[] {
  if (!value?.trim()) return [];
  return value.split(",").map((s) => s.trim()).filter(Boolean);
}

function source(
  id: string,
  label: string,
  status: SourceStatus,
  data: Record<string, unknown>,
  ms?: number,
): SourceEvidence {
  return { source: id, label, status, data, ms };
}

async function timed<T>(fn: () => Promise<T>): Promise<{ result: T; ms: number }> {
  const start = performance.now();
  const result = await fn();
  return { result, ms: Math.round(performance.now() - start) };
}

function gs1Status(data: Record<string, unknown>): SourceStatus {
  if (data.error) return "error";
  if (data.company_name || data.product_description) return "ok";
  return "empty";
}

async function appendGs1(
  sources: SourceEvidence[],
  barcode: string,
): Promise<Record<string, unknown>> {
  const { result: gs1, ms: gs1Ms } = await timed(() => lookupGs1(barcode));
  sources.push(source("gs1", "GS1 / Barcode lookup", gs1Status(gs1), gs1, gs1Ms));
  return gs1;
}

async function appendSerpApi(
  sources: SourceEvidence[],
  query: string,
  barcode?: string,
): Promise<Record<string, unknown> | undefined> {
  if (!serverConfig.serpApiKey) {
    sources.push(
      source("serp_api", "SerpApi Shopping", "not_configured", {
        note: "Aggiungi SERP_API_KEY in .env (serpapi.com)",
      }),
    );
    return undefined;
  }

  if (!query.trim() && !barcode) {
    sources.push(
      source("serp_api", "SerpApi Shopping", "skipped", {
        note: "Serve nome prodotto o barcode",
      }),
    );
    return undefined;
  }

  const { result: serp, ms } = await timed(() => searchShopping(query, barcode));
  const items = serp.shopping_results as unknown[] | undefined;
  sources.push(
    source(
      "serp_api",
      "SerpApi Shopping",
      serp.error ? "error" : items?.length ? "ok" : "empty",
      serp,
      ms,
    ),
  );
  return serp;
}

export interface BuildEvidenceInput {
  barcode?: string;
  productName?: string;
  brand?: string;
  ocr?: OcrExtraction;
}

/** Aggrega OCR + banche dati in struttura unificata ProductEvidence */
export async function buildProductEvidence(
  input: BuildEvidenceInput,
): Promise<ProductEvidence> {
  const sources: SourceEvidence[] = [];
  let offProduct = null;
  let barcode = input.barcode ?? input.ocr?.barcode;
  let searchMethod: ProductEvidence["searchMethod"] = "none";
  let searchQuery: string | undefined;

  const nameQuery =
    input.productName?.trim() ||
    input.ocr?.productName?.trim() ||
    undefined;
  const brandQuery = input.brand?.trim() || input.ocr?.brand?.trim();

  // Fallback: ricerca per nome su Open Facts se manca barcode
  if (!barcode && nameQuery) {
    searchQuery = brandQuery ? `${brandQuery} ${nameQuery}` : nameQuery;
    const { result: nameHit, ms } = await timed(() =>
      searchProductByName(nameQuery, brandQuery),
    );

    if (nameHit) {
      barcode = nameHit.barcode;
      offProduct = nameHit.product;
      searchMethod = "name";
      sources.push(
        source(
          "open_facts_search",
          "Open Facts (ricerca nome)",
          "ok",
          {
            query: searchQuery,
            matched: nameHit.product.product_name,
            barcode: nameHit.barcode,
            database: nameHit.product.source_database,
          },
          ms,
        ),
      );
    } else {
      sources.push(
        source(
          "open_facts_search",
          "Open Facts (ricerca nome)",
          "empty",
          { query: searchQuery },
          ms,
        ),
      );
    }
  }

  if (barcode) {
    if (!offProduct) {
      searchMethod = searchMethod === "name" ? "name" : "barcode";
      const { result, ms } = await timed(() => fetchUniversalProduct(barcode!));
      offProduct = result;

      if (result?.product_name || result?.brands) {
        sources.push(
          source(
            result.source_database,
            result.source_database.replace(/_/g, " "),
            "ok",
            result as unknown as Record<string, unknown>,
            ms,
          ),
        );
      } else {
        sources.push(
          source("open_facts", "Open Facts (universale)", "empty", {}, ms),
        );
      }
    } else {
      // Già trovato via nome — aggiungi record DB specifico
      sources.push(
        source(
          offProduct.source_database,
          offProduct.source_database.replace(/_/g, " "),
          "ok",
          offProduct as unknown as Record<string, unknown>,
        ),
      );
    }

    const gs1 = await appendGs1(sources, barcode);

    const certs = extractCertifications(offProduct);
    const certList = certs.certifications as { name: string; issuer: string; source: string }[];
    sources.push(
      source(
        "certifications_db",
        "Certificazioni",
        certList.length ? "ok" : "empty",
        certs,
      ),
    );

    const { result: customs, ms: customsMs } = await timed(() =>
      lookupCustoms(offProduct, barcode),
    );
    sources.push(
      source(
        "customs_un_comtrade",
        "Dogana / Comtrade",
        customs.hs_code || customs.last_import_country ? "ok" : "empty",
        customs,
        customsMs,
      ),
    );
  } else if (input.ocr) {
    searchMethod = "ocr_only";
    sources.push(
      source("open_facts", "Open Facts", "skipped", {
        note: "Serve barcode o nome prodotto",
      }),
    );
    sources.push(
      source("gs1", "GS1 / Barcode lookup", "skipped", {
        note: "Richiede barcode EAN",
      }),
    );
  }

  const productLabel =
    offProduct?.product_name ??
    nameQuery ??
    input.ocr?.productName ??
    "";
  const serpQuery = brandQuery
    ? `${brandQuery} ${productLabel}`.trim()
    : productLabel;

  const serp = await appendSerpApi(sources, serpQuery, barcode);

  if (input.ocr) {
    sources.push(
      source("ocr_label", "OCR etichetta", "ok", {
        rawText: input.ocr.rawText,
        barcode: input.ocr.barcode,
        productName: input.ocr.productName,
        brand: input.ocr.brand,
      }),
    );
  }

  const gs1Data = sources.find((s) => s.source === "gs1" && s.status === "ok")?.data;
  const serpData = sources.find((s) => s.source === "serp_api" && s.status === "ok")?.data;
  const customsData = sources.find((s) => s.source === "customs_un_comtrade" && s.status === "ok")?.data;
  const certData = sources.find((s) => s.source === "certifications_db")?.data;
  const certList = (certData?.certifications as ProductEvidence["certifications"]) ?? [];

  const ocrCerts = (input.ocr?.labelClaims ?? []).map((name) => ({
    name,
    issuer: "OCR etichetta",
    source: "ocr_label",
  }));

  return {
    id: barcode ?? `ocr-${Date.now()}`,
    barcode,
    searchMethod,
    searchQuery,
    identity: {
      name:
        offProduct?.product_name ??
        input.ocr?.productName ??
        (gs1Data?.product_description as string | undefined),
      brand:
        offProduct?.brands ??
        input.ocr?.brand ??
        (gs1Data?.company_name as string | undefined),
      category: offProduct?.categories,
      imageUrl: offProduct?.image_url,
    },
    composition: {
      ingredients: offProduct?.ingredients_text ?? input.ocr?.ingredients,
    },
    geography: {
      countries: splitList(offProduct?.countries),
      origins: [
        ...splitList(offProduct?.origins),
        ...(input.ocr?.originClaims ?? []),
      ],
      manufacturing: splitList(offProduct?.manufacturing_places),
    },
    certifications: [...certList, ...ocrCerts],
    customs: customsData
      ? {
          hsCode: customsData.hs_code as string | undefined,
          country: customsData.last_import_country as string | undefined,
          source: customsData.source as string | undefined,
        }
      : undefined,
    gs1: gs1Data,
    serp: serp,
    ocr: input.ocr,
    sources,
  };
}
