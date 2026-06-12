/** Metadati banche dati — condivisi server/UI */
export interface DatabaseMeta {
  id: string;
  label: string;
  short: string;
  color: string;
  /** Come si può interrogare questa fonte */
  searchBy: ("barcode" | "name")[];
}

export const DATABASE_CATALOG: DatabaseMeta[] = [
  {
    id: "open_food_facts",
    label: "Open Food Facts",
    short: "OFF",
    color: "#22c55e",
    searchBy: ["barcode", "name"],
  },
  {
    id: "open_beauty_facts",
    label: "Open Beauty Facts",
    short: "OBF",
    color: "#ec4899",
    searchBy: ["barcode", "name"],
  },
  {
    id: "open_products_facts",
    label: "Open Products Facts",
    short: "OPF",
    color: "#3b82f6",
    searchBy: ["barcode", "name"],
  },
  {
    id: "gs1",
    label: "GS1 / Barcode",
    short: "GS1",
    color: "#f97316",
    searchBy: ["barcode"],
  },
  {
    id: "certifications_db",
    label: "Certificazioni",
    short: "CERT",
    color: "#a855f7",
    searchBy: ["barcode"],
  },
  {
    id: "customs_un_comtrade",
    label: "Dogana",
    short: "DOG",
    color: "#64748b",
    searchBy: ["barcode"],
  },
  {
    id: "serp_api",
    label: "SerpApi Shopping",
    short: "SERP",
    color: "#eab308",
    searchBy: ["name"],
  },
];

export type DatabaseLampStatus =
  | "idle"
  | "loading"
  | "online"
  | "ok"
  | "empty"
  | "skipped"
  | "offline"
  | "not_configured";

export interface DatabaseLamp {
  id: string;
  status: DatabaseLampStatus;
  ms?: number;
  detail?: string;
}

/** Mappa source evidence → id catalogo */
export function mapSourceToCatalogId(source: string): string {
  if (source.startsWith("open_food") || source === "open_facts" || source === "open_facts_search") {
    return "open_food_facts";
  }
  if (source.startsWith("open_beauty")) return "open_beauty_facts";
  if (source.startsWith("open_products")) return "open_products_facts";
  if (source === "ocr_label") return "open_food_facts"; // OCR non è DB esterna
  return source;
}
