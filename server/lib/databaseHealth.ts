import { serverConfig } from "../config";
import { lookupGs1 } from "../connectors/gs1";
import { searchShopping } from "../connectors/serpApi";
import { fetchOpenFoodFacts } from "./openFactsClient";
import { DATABASE_CATALOG } from "./databaseCatalog";
import type { DatabaseLamp } from "./databaseCatalog";

const PROBE_BARCODE = "3017624010701";

async function timedReachable(fn: () => Promise<boolean>): Promise<{ ok: boolean; ms: number }> {
  const start = performance.now();
  try {
    const ok = await fn();
    return { ok, ms: Math.round(performance.now() - start) };
  } catch {
    return { ok: false, ms: Math.round(performance.now() - start) };
  }
}

/** Ping leggero — verifica raggiungibilità API (non analisi prodotto) */
export async function checkDatabasesReachability(): Promise<DatabaseLamp[]> {
  const lamps: DatabaseLamp[] = [];

  const off = await timedReachable(async () => !!(await fetchOpenFoodFacts(PROBE_BARCODE)));
  lamps.push({
    id: "open_food_facts",
    status: off.ok ? "online" : "offline",
    ms: off.ms,
    detail: off.ok ? "API raggiungibile" : "Non raggiungibile",
  });

  // OBF/OPF: stessa infra Open Facts
  for (const id of ["open_beauty_facts", "open_products_facts"] as const) {
    lamps.push({
      id,
      status: off.ok ? "online" : "offline",
      ms: off.ms,
      detail: off.ok ? "Stessa piattaforma OFF" : "Non raggiungibile",
    });
  }

  const gs1 = await timedReachable(async () => {
    const r = await lookupGs1(PROBE_BARCODE);
    return !r.error && !!(r.company_name || r.product_description);
  });
  lamps.push({
    id: "gs1",
    status: gs1.ok ? "online" : "offline",
    ms: gs1.ms,
    detail: gs1.ok ? "UPCitemdb trial OK" : "UPCitemdb non raggiungibile",
  });

  lamps.push({
    id: "certifications_db",
    status: off.ok ? "online" : "offline",
    detail: "Deriva da Open Facts",
  });

  lamps.push({
    id: "customs_un_comtrade",
    status: "online",
    detail: serverConfig.unComtradeApiKey ? "Comtrade + inferenza" : "Solo inferenza",
  });

  if (serverConfig.serpApiKey) {
    const serp = await timedReachable(async () => {
      const r = await searchShopping("Nutella", PROBE_BARCODE);
      const items = r.shopping_results as unknown[] | undefined;
      return !r.error && (items?.length ?? 0) > 0;
    });
    lamps.push({
      id: "serp_api",
      status: serp.ok ? "online" : "offline",
      ms: serp.ms,
      detail: serp.ok ? "SerpApi connessa" : "SerpApi errore o quota",
    });
  } else {
    lamps.push({
      id: "serp_api",
      status: "not_configured",
      detail: "SERP_API_KEY assente — serpapi.com",
    });
  }

  return lamps.map((l) => {
    const meta = DATABASE_CATALOG.find((d) => d.id === l.id);
    return { ...l, detail: l.detail ?? meta?.label };
  });
}
