import { fetchJson } from "./http";

const OFF_FIELDS = [
  "product_name",
  "brands",
  "categories",
  "countries",
  "origins",
  "manufacturing_places",
  "ingredients_text",
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

export interface FlatOpenProduct {
  product_name?: string;
  brands?: string;
  categories?: string;
  countries?: string;
  origins?: string;
  manufacturing_places?: string;
  purchase_places?: string;
  emb_codes?: string;
  ingredients_text?: string;
  labels?: string;
  labels_tags?: string[];
  image_url?: string;
  product_type?: string;
  source_database: string;
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
    origins: String(product.origins ?? ""),
    manufacturing_places: String(product.manufacturing_places ?? ""),
    purchase_places: String(product.purchase_places ?? ""),
    emb_codes: String(product.emb_codes ?? ""),
    ingredients_text: String(product.ingredients_text ?? ""),
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

/** Ricerca per nome/marca su Open Facts (fallback se manca barcode) */
export async function searchProductByName(
  name: string,
  brand?: string,
): Promise<{ product: FlatOpenProduct; barcode: string } | null> {
  const query = [brand, name].filter(Boolean).join(" ").trim();
  if (query.length < 2) return null;

  const bases = [
    { base: "https://world.openfoodfacts.org", label: "open_food_facts" },
    { base: "https://world.openbeautyfacts.org", label: "open_beauty_facts" },
    { base: "https://world.openproductsfacts.org", label: "open_products_facts" },
  ] as const;

  for (const source of bases) {
    const url =
      `${source.base}/cgi/search.pl?search_terms=${encodeURIComponent(query)}` +
      `&search_simple=1&action=process&json=1&page_size=1`;

    const result = await fetchJson<LegacySearchResponse>(url);
    const hit = result.data?.products?.[0];
    if (!hit?.code) continue;

    const full = await fetchFromBase(source.base, source.label, hit.code);
    if (full?.product_name || full?.brands) {
      return { product: full, barcode: hit.code };
    }
  }

  return null;
}
