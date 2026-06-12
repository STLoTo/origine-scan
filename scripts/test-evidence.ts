/**
 * Test pipeline OCR + banche dati (ProductEvidence)
 * Esegui: npx tsx scripts/test-evidence.ts [barcode]
 */
import "dotenv/config";
import { buildProductEvidence } from "../server/core/evidenceBuilder";
import type { OcrExtraction } from "../server/types/evidence";

const DEFAULT_BARCODE = "3017624010701";

function statusMark(status: string): string {
  if (status === "ok") return "✓";
  if (status === "empty") return "○";
  if (status === "skipped") return "—";
  return "✗";
}

async function runCase(label: string, input: Parameters<typeof buildProductEvidence>[0]) {
  console.log(`\n--- ${label} ---`);
  const evidence = await buildProductEvidence(input);

  console.log(`  Barcode:   ${evidence.barcode ?? "—"}`);
  console.log(`  Nome:      ${evidence.identity.name ?? "—"}`);
  console.log(`  Marca:     ${evidence.identity.brand ?? "—"}`);
  console.log(`  Categoria: ${evidence.identity.category ?? "—"}`);

  if (evidence.composition?.ingredients) {
    console.log(`  Ingredienti: ${evidence.composition.ingredients.slice(0, 80)}…`);
  }

  if (evidence.geography.countries.length) {
    console.log(`  Paesi:     ${evidence.geography.countries.join(", ")}`);
  }

  if (evidence.customs?.hsCode) {
    console.log(`  HS code:   ${evidence.customs.hsCode} (${evidence.customs.country ?? "—"})`);
  }

  console.log("\n  Fonti:");
  for (const s of evidence.sources) {
    console.log(
      `    ${statusMark(s.status)} ${s.label.padEnd(28)} ${s.status.padEnd(8)} ${s.ms != null ? `${s.ms}ms` : ""}`,
    );
  }

  const ok = evidence.sources.filter((s) => s.status === "ok").length;
  console.log(`\n  → ${ok}/${evidence.sources.length} fonti con dati`);
  return evidence;
}

async function main() {
  const barcode = process.argv[2] ?? DEFAULT_BARCODE;

  console.log("=".repeat(60));
  console.log("OrigineScan — TEST PIPELINE BANCHE DATI");
  console.log("=".repeat(60));

  // Caso 1: solo barcode (come scan manuale)
  await runCase(`Solo barcode: ${barcode}`, { barcode });

  // Caso 2: OCR simulato + barcode (come Analizza completo)
  const ocrSimulated: OcrExtraction = {
    rawText: `Nutella\nFerrero\n3017624010701\nIngredienti: zucchero, olio di palma…`,
    barcode,
    productName: "Nutella",
    brand: "Ferrero",
    originClaims: ["Made in Italy"],
    labelClaims: [],
    provider: "test",
    model: "simulated",
  };
  await runCase("OCR simulato + barcode", { barcode, ocr: ocrSimulated });

  // Caso 3: solo OCR senza barcode (limite attuale)
  await runCase("Solo OCR (no barcode)", {
    ocr: {
      ...ocrSimulated,
      barcode: undefined,
    },
  });

  // Caso 4: prodotto bio (certificazioni)
  await runCase("Prodotto bio (cert)", { barcode: "3760049790214" });

  // Caso 5: Valsoia Tofu — OCR corretto, DB deve essere rifiutato se match crema spalmabile
  const valsoiaOcr: OcrExtraction = {
    rawText: `VALSOIA
VALSOIA
BONTÀ E SALUTE

TOFU
NATURALE

100% VEGETALE

L'immagine ha il solo scopo di presentare il prodotto.

Ricco di proteine vegetali
Senza sale aggiunto

VALSOIA

2 x 125g`,
    productName: "TOFU NATURALE",
    brand: "VALSOIA",
    originClaims: [],
    labelClaims: [],
    provider: "test",
    model: "simulated",
  };
  await runCase("Valsoia Tofu (anti-mismatch)", { ocr: valsoiaOcr });

  console.log("\n" + "=".repeat(60));
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
