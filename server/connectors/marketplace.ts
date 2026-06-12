import { searchShopping } from "./serpApi";

/** Deriva dati marketplace da Google Shopping / SerpApi */
export async function lookupMarketplace(
  productName: string,
  barcode?: string,
): Promise<Record<string, unknown>> {
  const serp = await searchShopping(productName, barcode);
  const results = serp.shopping_results as Array<Record<string, string>> | undefined;

  if (!results?.length) {
    return { seller: undefined, declared_origin: undefined, rating: undefined };
  }

  const top = results[0];
  return {
    seller: top.seller ?? top.source,
    declared_origin: top.origin_note ?? "Non specificato dal marketplace",
    rating: undefined,
    listings_count: results.length,
    top_listing: top.title,
  };
}
