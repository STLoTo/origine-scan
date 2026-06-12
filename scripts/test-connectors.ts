/**
 * Test diretto collegamento banche dati — senza UI, senza mock
 * Esegui: npm test
 */
import "dotenv/config";
import { extractCertifications } from "../server/connectors/certifications";
import { lookupCustoms } from "../server/connectors/customs";
import { lookupDpp } from "../server/connectors/dpp";
import { lookupGs1 } from "../server/connectors/gs1";
import { lookupMarketplace } from "../server/connectors/marketplace";
import { searchShopping } from "../server/connectors/serpApi";
import {
  fetchOpenBeautyFacts,
  fetchOpenFoodFacts,
  fetchOpenProductsFacts,
  fetchUniversalProduct,
} from "../server/lib/openFactsClient";
import { serverConfig } from "../server/config";

const TEST_BARCODE_FOOD = "3017624010701"; // Nutella — OFF + dogana
const TEST_BARCODE_BEAUTY = "3600551054476"; // cosmetico OBF
const TEST_BARCODE_PRODUCT = "4030600259702"; // Cigarettes — presente in OPF
const TEST_BARCODE_CERT = "3760049790214"; // Pain De Mie Bio — labels organic

type Status = "OK" | "VUOTO" | "ERRORE" | "NON_CONFIGURATO" | "NON_DISPONIBILE";

interface DbResult {
  id: string;
  label: string;
  status: Status;
  ms: number;
  detail: string;
}

const results: DbResult[] = [];

async function timed<T>(fn: () => Promise<T>): Promise<{ result: T; ms: number }> {
  const start = performance.now();
  const result = await fn();
  return { result, ms: Math.round(performance.now() - start) };
}

function record(id: string, label: string, status: Status, ms: number, detail: string) {
  results.push({ id, label, status, ms, detail });
  const mark = status === "OK" ? "✓" : status === "VUOTO" ? "○" : "✗";
  console.log(`  ${mark} ${label.padEnd(32)} ${status.padEnd(18)} ${String(ms).padStart(5)}ms  ${detail}`);
}

async function testOpenFoodFacts() {
  const { result, ms } = await timed(() => fetchOpenFoodFacts(TEST_BARCODE_FOOD));
  if (result?.product_name)
    record("open_food_facts", "Open Food Facts", "OK", ms, result.product_name);
  else record("open_food_facts", "Open Food Facts", "VUOTO", ms, "Nessun dato");
}

async function testOpenBeautyFacts() {
  const { result, ms } = await timed(() => fetchOpenBeautyFacts(TEST_BARCODE_BEAUTY));
  if (result?.product_name)
    record("open_beauty_facts", "Open Beauty Facts", "OK", ms, result.product_name);
  else record("open_beauty_facts", "Open Beauty Facts", "VUOTO", ms, "Prodotto non in OBF");
}

async function testOpenProductsFacts() {
  const { result, ms } = await timed(() => fetchOpenProductsFacts(TEST_BARCODE_PRODUCT));
  if (result?.product_name)
    record("open_products_facts", "Open Products Facts", "OK", ms, result.product_name);
  else record("open_products_facts", "Open Products Facts", "VUOTO", ms, "Prodotto non in OPF");
}

async function testUniversalResolve() {
  const { result, ms } = await timed(() => fetchUniversalProduct(TEST_BARCODE_FOOD));
  if (result?.product_name)
    record("universal_resolve", "Resolver universale OFF", "OK", ms, `${result.product_name} (${result.source_database})`);
  else record("universal_resolve", "Resolver universale OFF", "ERRORE", ms, "Resolve fallito");
}

async function testGs1() {
  const { result, ms } = await timed(() => lookupGs1(TEST_BARCODE_FOOD));
  if (result.company_name || result.product_description)
    record("gs1", "GS1 / Barcode lookup", "OK", ms, String(result.company_name ?? result.product_description));
  else record("gs1", "GS1 / Barcode lookup", "VUOTO", ms, "Nessun match");
}

async function testSerpApi() {
  if (!serverConfig.serpApiKey) {
    record("serp_api", "SerpApi / Google Shopping", "NON_CONFIGURATO", 0, "SERP_API_KEY assente in .env");
    return;
  }
  const { result, ms } = await timed(() => searchShopping("Nutella", TEST_BARCODE_FOOD));
  const items = result.shopping_results as unknown[] | undefined;
  if (items?.length)
    record("serp_api", "SerpApi / Google Shopping", "OK", ms, `${items.length} risultati`);
  else record("serp_api", "SerpApi / Google Shopping", "VUOTO", ms, String(result.error ?? "Nessun risultato"));
}

async function testMarketplace() {
  if (!serverConfig.serpApiKey) {
    record("marketplace", "Marketplace (via SerpApi)", "NON_CONFIGURATO", 0, "Richiede SERP_API_KEY");
    return;
  }
  const { result, ms } = await timed(() => lookupMarketplace("Nutella", TEST_BARCODE_FOOD));
  if (result.seller)
    record("marketplace", "Marketplace (via SerpApi)", "OK", ms, String(result.seller));
  else record("marketplace", "Marketplace (via SerpApi)", "VUOTO", ms, "Nessun listing");
}

async function testCertifications() {
  const off = await fetchOpenFoodFacts(TEST_BARCODE_CERT);
  const { result, ms } = await timed(async () => extractCertifications(off));
  const certs = result.certifications as { name?: string }[];
  if (certs?.length)
    record(
      "certifications_db",
      "Certificazioni (da labels)",
      "OK",
      ms,
      `${certs.length} trovate (es. ${certs[0]?.name ?? "—"})`,
    );
  else record("certifications_db", "Certificazioni (da labels)", "VUOTO", ms, "Nessuna certificazione su prodotto test");
}

async function testCustoms() {
  const off = await fetchOpenFoodFacts(TEST_BARCODE_FOOD);
  const { result, ms } = await timed(() => lookupCustoms(off, TEST_BARCODE_FOOD));
  if (result.hs_code || result.last_import_country) {
    const parts = [
      result.hs_code ? `HS ${result.hs_code}` : null,
      result.last_import_country ? `paese ${result.last_import_country}` : null,
      serverConfig.unComtradeApiKey ? null : "(inferenza)",
    ].filter(Boolean);
    record("customs_un_comtrade", "Dogana / Comtrade", "OK", ms, parts.join(" · "));
  } else record("customs_un_comtrade", "Dogana / Comtrade", "VUOTO", ms, String(result.note ?? "Nessun dato"));
}

async function testDpp() {
  const { result, ms } = await timed(() => lookupDpp(TEST_BARCODE_FOOD));
  record("digital_product_passport", "Digital Product Passport", "NON_DISPONIBILE", ms, String(result.note ?? "Non implementato"));
}

async function main() {
  console.log("=".repeat(70));
  console.log("OrigineScan — TEST COLLEGAMENTO BANCHE DATI");
  console.log("=".repeat(70));
  console.log(`SerpApi key: ${serverConfig.serpApiKey ? "configurata" : "ASSENTE"}`);
  console.log(`UN Comtrade key: ${serverConfig.unComtradeApiKey ? "configurata" : "ASSENTE (solo inferenza)"}`);
  console.log("");

  console.log("Risultati:\n");

  await testOpenFoodFacts();
  await testOpenBeautyFacts();
  await testOpenProductsFacts();
  await testUniversalResolve();
  await testGs1();
  await testSerpApi();
  await testMarketplace();
  await testCertifications();
  await testCustoms();
  await testDpp();

  const ok = results.filter((r) => r.status === "OK");
  const broken = results.filter((r) => r.status === "ERRORE" || r.status === "NON_CONFIGURATO");
  const empty = results.filter((r) => r.status === "VUOTO");
  const nd = results.filter((r) => r.status === "NON_DISPONIBILE");

  console.log("\n" + "=".repeat(70));
  console.log("RIEPILOGO");
  console.log("=".repeat(70));
  console.log(`  Funzionanti:        ${ok.length}  → ${ok.map((r) => r.id).join(", ") || "—"}`);
  console.log(`  Vuote (no dati):    ${empty.length}  → ${empty.map((r) => r.id).join(", ") || "—"}`);
  console.log(`  Non configurate:    ${broken.filter((r) => r.status === "NON_CONFIGURATO").length}  → ${broken.filter((r) => r.status === "NON_CONFIGURATO").map((r) => r.id).join(", ") || "—"}`);
  console.log(`  Non disponibili:    ${nd.length}  → ${nd.map((r) => r.id).join(", ") || "—"}`);

  if (broken.length || empty.length) {
    console.log("\n  DB DA SISTEMARE / CONFIGURARE:");
    for (const r of [...broken, ...empty]) {
      console.log(`    - ${r.label}: ${r.detail}`);
    }
  }

  console.log("=".repeat(70));

  // Exit 0 se almeno OFF funziona
  process.exit(ok.some((r) => r.id === "open_food_facts") ? 0 : 1);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
