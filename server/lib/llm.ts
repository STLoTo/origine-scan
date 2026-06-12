import { serverConfig } from "../config";
import { chatCompletion, isInfomaniakConfigured } from "./infomaniakClient";
import type { AiAnalysis, ProductEvidence } from "../types/evidence";

export { checkInfomaniakLlmAvailable } from "./infomaniakClient";

const SYSTEM_PROMPT =
  "Sei un analista di trasparenza filiera produttiva. Rispondi in italiano. " +
  "Non giudicare in base al paese. Distingui fatti verificati da claim incerti. " +
  "Se sono presenti risultati di ricerca web o il profilo filiera (supplyChain), usali per affinare la sintesi (marca, categoria, origine, contesto). " +
  "Il web non è fonte assoluta: confrontalo con OCR e banche dati e segnala conflitti. " +
  "Per ogni origine ingrediente indica il livello di certezza (verified/partial/unavailable). " +
  "Rispondi SOLO con JSON valido, senza markdown. " +
  "verifiedFacts, uncertainClaims e conflicts devono essere array di STRINGHE, non oggetti.";

function buildWebContext(webSearch?: Record<string, unknown>): string {
  const web = webSearch as
    | {
        query?: string;
        organic_results?: Array<{ title?: string; snippet?: string; source?: string }>;
        answer_box?: { title?: string; snippet?: string };
        knowledge_graph?: { title?: string; description?: string };
      }
    | undefined;

  if (!web) return "";

  const hasOrganic = (web.organic_results?.length ?? 0) > 0;
  const hasAnswer = Boolean(web.answer_box?.snippet);
  const hasKg = Boolean(web.knowledge_graph?.description);
  if (!hasOrganic && !hasAnswer && !hasKg) return "";

  return (
    "\n\nRicerca web (Google via SerpApi — usa per affinare la sintesi, non ignorare conflitti con OCR/DB):\n" +
    JSON.stringify(
      {
        query: web.query,
        answer_box: web.answer_box,
        knowledge_graph: web.knowledge_graph,
        organic_results: web.organic_results?.slice(0, 5),
      },
      null,
      2,
    )
  );
}

function buildUserPrompt(evidence: ProductEvidence): string {
  const { webSearch, supplyChain, ...evidenceCore } = evidence;
  return `Analizza queste evidenze prodotto e produci JSON:
{
  "summary": "4-6 frasi in italiano",
  "transparencyLevel": "high|medium|low",
  "verifiedFacts": ["stringa 1", "stringa 2"],
  "uncertainClaims": ["stringa 1"],
  "conflicts": ["stringa 1"]
}

Evidenze:
${JSON.stringify(evidenceCore, null, 2)}${buildWebContext(webSearch)}${buildSupplyChainContext(supplyChain)}`;
}

function buildSupplyChainContext(supplyChain?: ProductEvidence["supplyChain"]): string {
  if (!supplyChain) return "";
  return (
    "\n\nProfilo filiera (origine prodotto e ingredienti — rispetta i livelli verified/partial/unavailable):\n" +
    JSON.stringify(supplyChain, null, 2)
  );
}

function normalizeStrings(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value
    .map((item) => {
      if (typeof item === "string") return item;
      if (item && typeof item === "object") {
        const o = item as Record<string, unknown>;
        return String(o.fact ?? o.claim ?? o.text ?? o.description ?? o.message ?? "");
      }
      return String(item);
    })
    .filter(Boolean);
}

function parseAnalysis(content: string, provider: string, model: string): AiAnalysis {
  const jsonMatch = content.match(/\{[\s\S]*\}/);
  if (!jsonMatch) {
    return fallbackAnalysis(content, provider, model);
  }

  try {
    const p = JSON.parse(jsonMatch[0]) as Record<string, unknown>;
    const level = p.transparencyLevel as string;
    const summary = String(p.summary ?? "").trim();
    const verifiedFacts = normalizeStrings(p.verifiedFacts);
    const uncertainClaims = normalizeStrings(p.uncertainClaims);
    const conflicts = normalizeStrings(p.conflicts);

    const finalSummary =
      summary ||
      (verifiedFacts.length
        ? verifiedFacts.slice(0, 3).join(" ")
        : content.replace(/\{[\s\S]*\}/, "").trim().slice(0, 600));

    return {
      available: true,
      summary: finalSummary,
      transparencyLevel:
        level === "high" || level === "low" ? level : "medium",
      verifiedFacts,
      uncertainClaims,
      conflicts,
      provider: provider as AiAnalysis["provider"],
      model,
    };
  } catch {
    return fallbackAnalysis(content, provider, model);
  }
}

function fallbackAnalysis(text: string, provider: string, model: string): AiAnalysis {
  return {
    available: true,
    summary: text.slice(0, 800),
    transparencyLevel: "medium",
    verifiedFacts: [],
    uncertainClaims: [],
    conflicts: [],
    provider: provider as AiAnalysis["provider"],
    model,
  };
}

async function callInfomaniak(evidence: ProductEvidence): Promise<AiAnalysis> {
  const model = serverConfig.infomaniakLlmModel;
  const content = await chatCompletion({
    model,
    temperature: 0.3,
    messages: [
      { role: "system", content: SYSTEM_PROMPT },
      { role: "user", content: buildUserPrompt(evidence) },
    ],
  });
  return parseAnalysis(content, "infomaniak", model);
}

function templateAnalysis(evidence: ProductEvidence): AiAnalysis {
  const name = evidence.identity.name ?? evidence.ocr?.productName ?? "Prodotto";
  const sources = evidence.sources.filter((s) => s.status === "ok").map((s) => s.label);
  return {
    available: false,
    summary: `${name}: raccolte evidenze da ${sources.length} fonti (${sources.join(", ") || "nessuna"}). AI non disponibile — configura Infomaniak API.`,
    transparencyLevel: sources.length >= 3 ? "medium" : "low",
    verifiedFacts: sources.length
      ? [`Dati presenti su: ${sources.join(", ")}`]
      : [],
    uncertainClaims: evidence.ocr?.originClaims ?? [],
    conflicts: [],
    reason: "LLM non configurato o non raggiungibile",
  };
}

export async function analyzeWithAi(evidence: ProductEvidence): Promise<AiAnalysis> {
  if (serverConfig.aiProvider === "none") return templateAnalysis(evidence);

  if (!isInfomaniakConfigured()) return templateAnalysis(evidence);

  try {
    return await callInfomaniak(evidence);
  } catch (err) {
    const reason = err instanceof Error ? err.message : "Errore LLM";
    const base = templateAnalysis(evidence);
    return { ...base, reason };
  }
}
