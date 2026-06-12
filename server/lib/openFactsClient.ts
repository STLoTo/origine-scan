import { fetchJson } from "./http";
import { scoreProductAgainstOcr } from "./productMatch";

const OFF_FIELDS = [
  "product_name",
  "brands",
  "categories",
  "countries",
  "countries_tags",
  "origins",
  "origins_tags",
  "origin",
  "manufacturing_places",
  "manufacturing_places_tags",
  "ingredients_text",
  "ingredients",
  "labels",
  "labels_tags",
  "codes_tags",
  "image_url",
  "image_front_url",
  "emb_codes",
  "purchase_places",
].join(",");

interface OffApiResponse {
  status: number;
  code?: string;
  product?: Record<string, unknown>;
  product_type?: string;
}

export interface StructuredIngredient {
  text: string;
  percentEstimate?: number;
  percentMin?: number;
  percentMax?: number;
}

export interface FlatOpenProduct {
  product_name?: string;
  brands?: string;
  categories?: string;
  countries?: string;
  countries_tags?: string[];
  origins?: string;
  origins_tags?: string[];
  /** Testo libero origine prodotto/ingredienti (campo origin OFF) */
  origin?: string;
  manufacturing_places?: string;
  manufacturing_places_tags?: string[];
  purchase_places?: string;
  emb_codes?: string;
  ingredients_text?: string;
  ingredients_structured?: StructuredIngredient[];
  labels?: string;
  labels_tags?: string[];
  image_url?: string;
  product_type?: string;
  source_database: string;
}

function flattenIngredients(raw: unknown): StructuredIngredient[] | undefined {
  if (!Array.isArray(raw)) return undefined;
  const list = raw
    .map((item) => {
      if (!item || typeof item !== "object") return null;
      const o = item as Record<string, unknown>;
      const text = String(o.text ?? "").trim();
      if (!text) return null;
      return {
        text,
        percentEstimate:
          typeof o.percent_estimate === "number" ? o.percent_estimate : undefined,
        percentMin: typeof o.percent_min === "number" ? o.percent_min : undefined,
        percentMax: typeof o.percent_max === "number" ? o.percent_max : undefined,
      };
    })
    .filter(Boolean) as StructuredIngredient[];
  return list.length ? list : undefined;
}

function flattenProduct(
  product: Record<string, unknown>,
  sourceDatabase: string,
  productType?: string,
): FlatOpenProduct {
  return {
    product_name: String(product.product_name ?? product.product_name_it ?? ""),
    brands: String(product.brands ?? ""),
    categories: String(product.categories ?? ""),
    countries: String(product.countries ?? ""),
    countries_tags: Array.isArray(product.countries_tags)
      ? (product.countries_tags as string[])
      : undefined,
    origins: String(product.origins ?? ""),
    origins_tags: Array.isArray(product.origins_tags)
      ? (product.origins_tags as string[])
      : undefined,
    origin: String(product.origin ?? product.origin_it ?? product.origin_fr ?? ""),
    manufacturing_places: String(product.manufacturing_places ?? ""),
    manufacturing_places_tags: Array.isArray(product.manufacturing_places_tags)
      ? (product.manufacturing_places_tags as string[])
      : undefined,
    purchase_places: String(product.purchase_places ?? ""),
    emb_codes: String(product.emb_codes ?? ""),
    ingredients_text: String(product.ingredients_text ?? ""),
    ingredients_structured: flattenIngredients(product.ingredients),
    labels: String(product.labels ?? ""),
    labels_tags: Array.isArray(product.labels_tags)
      ? (product.labels_tags as string[])
      : undefined,
    image_url: String(product.image_front_url ?? product.image_url ?? ""),
    product_type: productType,
    source_database: sourceDatabase,
  };
}

async function fetchFromBase(
  baseUrl: string,
  databaseLabel: string,
  barcode: string,
): Promise<FlatOpenProduct | null> {
  const url = `${baseUrl}/api/v2/product/${barcode}.json?fields=${OFF_FIELDS}`;
  const result = await fetchJson<OffApiResponse>(url);

  if (!result.ok || !result.data || result.data.status !== 1 || !result.data.product) {
    return null;
  }

  return flattenProduct(result.data.product, databaseLabel, result.data.product_type);
}

export async function fetchUniversalProduct(barcode: string): Promise<FlatOpenProduct | null> {
  const universalUrl = `https://world.openfoodfacts.org/api/v2/product/${barcode}.json?fields=${OFF_FIELDS}&product_type=all`;
  const universal = await fetchJson<OffApiResponse>(universalUrl);

  if (universal.ok && universal.data?.status === 1 && universal.data.product) {
    const db =
      universal.data.product_type === "beauty"
        ? "open_beauty_facts"
        : universal.data.product_type === "product"
          ? "open_products_facts"
          : "open_food_facts";
    return flattenProduct(universal.data.product, db, universal.data.product_type);
  }

  const order = [
    { base: "https://world.openfoodfacts.org", label: "open_food_facts" },
    { base: "https://world.openbeautyfacts.org", label: "open_beauty_facts" },
    { base: "https://world.openproductsfacts.org", label: "open_products_facts" },
  ] as const;

  for (const source of order) {
    const product = await fetchFromBase(source.base, source.label, barcode);
    if (product?.product_name || product?.brands) return product;
  }

  return null;
}

export async function fetchOpenFoodFacts(barcode: string): Promise<FlatOpenProduct | null> {
  return fetchFromBase("https://world.openfoodfacts.org", "open_food_facts", barcode);
}

export async function fetchOpenBeautyFacts(barcode: string): Promise<FlatOpenProduct | null> {
  return fetchFromBase("https://world.openbeautyfacts.org", "open_beauty_facts", barcode);
}

export async function fetchOpenProductsFacts(barcode: string): Promise<FlatOpenProduct | null> {
  return fetchFromBase("https://world.openproductsfacts.org", "open_products_facts", barcode);
}

interface LegacySearchResponse {
  products?: Array<{ code?: string; product_name?: string; brands?: string }>;
}

interface NameSearchOptions {
  brand?: string;
  /** Testo OCR completo per scegliere il match più coerente */
  ocrText?: string;
  labelKind?: "food" | "cosmetic" | "cleaning" | "unknown";
}

const ALL_DATABASES = [
  { base: "https://world.openfoodfacts.org", label: "open_food_facts" },
  { base: "https://world.openbeautyfacts.org", label: "open_beauty_facts" },
  { base: "https://world.openproductsfacts.org", label: "open_products_facts" },
] as const;

function databasesForLabelKind(
  labelKind?: NameSearchOptions["labelKind"],
): typeof ALL_DATABASES[number][] {
  if (labelKind === "cleaning") {
    return [ALL_DATABASES[2], ALL_DATABASES[1], ALL_DATABASES[0]];
  }
  if (labelKind === "cosmetic") {
    return [ALL_DATABASES[1], ALL_DATABASES[2], ALL_DATABASES[0]];
  }
  return [...ALL_DATABASES];
}

/** Ricerca per nome/marca su Open Facts (fallback se manca barcode) */
export async function searchProductByName(
  name: string,
  brandOrOptions?: string | NameSearchOptions,
  legacyBrand?: string,
): Promise<{ product: FlatOpenProduct; barcode: string } | null> {
  const options: NameSearchOptions =
    typeof brandOrOptions === "string"
      ? { brand: brandOrOptions ?? legacyBrand }
      : (brandOrOptions ?? { brand: legacyBrand });

  const brand = options.brand;
  const query = [brand, name].filter(Boolean).join(" ").trim();
  if (query.length < 2) return null;

  const bases = databasesForLabelKind(options.labelKind);

  let best: { product: FlatOpenProduct; barcode: string; score: number } | null = null;

  for (const source of bases) {
    const url =
      `${source.base}/cgi/search.pl?search_terms=${encodeURIComponent(query)}` +
      `&search_simple=1&action=process&json=1&page_size=5`;

    const result = await fetchJson<LegacySearchResponse>(url);
    const hits = result.data?.products ?? [];

    for (const hit of hits) {
      if (!hit?.code) continue;

      const full = await fetchFromBase(source.base, source.label, hit.code);
      if (!full?.product_name && !full?.brands) continue;

      const score = options.ocrText
        ? scoreProductAgainstOcr(options.ocrText, full, brand)
        : 0.5;

      if (!best || score > best.score) {
        best = { product: full, barcode: hit.code, score };
      }
    }

    if (best && best.score >= 0.2) break;
  }

  if (!best) return null;
  if (options.ocrText && best.score < 0.15) return null;

  return { product: best.product, barcode: best.barcode };
}
