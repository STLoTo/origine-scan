/** Digital Product Passport — predisposto, non ancora disponibile su larga scala */
export async function lookupDpp(_barcode: string): Promise<Record<string, unknown>> {
  return {
    available: false,
    note: "Digital Product Passport non ancora disponibile per questo prodotto",
    standards: ["EU ESPR (futuro)", "CIRPASS pilot"],
  };
}
