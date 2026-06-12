/** Metadati banche dati — mirror client di server/lib/databaseCatalog.ts */
export interface DatabaseMeta {
  id: string;
  label: string;
  short: string;
  color: string;
  searchBy: ("barcode" | "name")[];
}

export const DATABASE_CATALOG: DatabaseMeta[] = [
  { id: "open_food_facts", label: "Open Food Facts", short: "OFF", color: "#22c55e", searchBy: ["barcode", "name"] },
  { id: "open_beauty_facts", label: "Open Beauty Facts", short: "OBF", color: "#ec4899", searchBy: ["barcode", "name"] },
  { id: "open_products_facts", label: "Open Products Facts", short: "OPF", color: "#3b82f6", searchBy: ["barcode", "name"] },
  { id: "gs1", label: "GS1 / Barcode", short: "GS1", color: "#f97316", searchBy: ["barcode"] },
  { id: "certifications_db", label: "Certificazioni", short: "CERT", color: "#a855f7", searchBy: ["barcode"] },
  { id: "customs_un_comtrade", label: "Dogana", short: "DOG", color: "#64748b", searchBy: ["barcode"] },
  { id: "serp_api", label: "SerpApi", short: "SERP", color: "#eab308", searchBy: ["name"] },
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

export function mapSourceToCatalogId(source: string): string {
  if (source.startsWith("open_food") || source === "open_facts" || source === "open_facts_search") {
    return "open_food_facts";
  }
  if (source.startsWith("open_beauty")) return "open_beauty_facts";
  if (source.startsWith("open_products")) return "open_products_facts";
  return source;
}

export function defaultDatabaseLamps(status: DatabaseLampStatus, detail?: string): DatabaseLamp[] {
  return DATABASE_CATALOG.map((d) => ({ id: d.id, status, detail }));
}

export function mergeLampsFromEvidence(
  base: DatabaseLamp[],
  sources: { source: string; status: string; ms?: number }[],
): DatabaseLamp[] {
  const map = new Map(base.map((l) => [l.id, { ...l }]));

  for (const s of sources) {
    const id = mapSourceToCatalogId(s.source);
    if (id === "open_food_facts" && s.source === "open_facts_search") {
      // Ricerca nome su OFF
    }
    const lamp = map.get(id);
    if (!lamp) continue;

    if (s.status === "ok") {
      lamp.status = "ok";
      lamp.ms = s.ms;
      lamp.detail = "Dati ricevuti";
    } else if (s.status === "empty") {
      lamp.status = lamp.status === "ok" ? "ok" : "empty";
      lamp.detail = "Interrogata, nessun dato";
    } else if (s.status === "skipped") {
      lamp.status = "skipped";
      lamp.detail = "Non interrogata (serve EAN)";
    } else if (s.status === "not_configured") {
      lamp.status = "not_configured";
      lamp.detail = "Chiave API mancante";
    } else if (s.status === "error") {
      lamp.status = "offline";
      lamp.detail = "Errore connessione";
    }
  }

  return DATABASE_CATALOG.map((d) => map.get(d.id) ?? { id: d.id, status: "idle" as const });
}

export const LAMP_STYLE: Record<
  DatabaseLampStatus,
  { ring: string; dot: string; label: string }
> = {
  idle: { ring: "border-slate-700", dot: "bg-slate-600", label: "In attesa" },
  loading: { ring: "border-sky-500/50 animate-pulse", dot: "bg-sky-400", label: "Interroga…" },
  online: { ring: "border-emerald-500/40", dot: "bg-emerald-400", label: "Online" },
  ok: { ring: "border-emerald-500", dot: "bg-emerald-400", label: "Dati OK" },
  empty: { ring: "border-amber-500/50", dot: "bg-amber-400", label: "Vuota" },
  skipped: { ring: "border-slate-600", dot: "bg-slate-500", label: "Saltata" },
  offline: { ring: "border-rose-500/50", dot: "bg-rose-500", label: "Offline" },
  not_configured: { ring: "border-slate-700 border-dashed", dot: "bg-slate-700", label: "Non config." },
};
