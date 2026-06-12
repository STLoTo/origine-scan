import { serverConfig } from "../config";
import type { AiAnalysis, ProductEvidence } from "../types/evidence";

const SYSTEM_PROMPT =
  "Sei un analista di trasparenza filiera produttiva. Rispondi in italiano. " +
  "Non giudicare in base al paese. Distingui fatti verificati da claim incerti. " +
  "Rispondi SOLO con JSON valido, senza markdown. " +
  "verifiedFacts, uncertainClaims e conflicts devono essere array di STRINGHE, non oggetti.";

function buildUserPrompt(evidence: ProductEvidence): string {
  return `Analizza queste evidenze prodotto e produci JSON:
{
  "summary": "4-6 frasi in italiano",
  "transparencyLevel": "high|medium|low",
  "verifiedFacts": ["stringa 1", "stringa 2"],
  "uncertainClaims": ["stringa 1"],
  "conflicts": ["stringa 1"]
}

Evidenze:
${JSON.stringify(evidence, null, 2)}`;
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

async function callOllama(evidence: ProductEvidence): Promise<AiAnalysis> {
  const model = serverConfig.ollamaModel;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), serverConfig.llmTimeoutMs);

  try {
    const res = await fetch(`${serverConfig.ollamaBaseUrl}/api/chat`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      signal: controller.signal,
      body: JSON.stringify({
        model,
        stream: false,
        messages: [
          { role: "system", content: SYSTEM_PROMPT },
          { role: "user", content: buildUserPrompt(evidence) },
        ],
      }),
    });

    if (!res.ok) throw new Error(`Ollama HTTP ${res.status}`);
    const data = (await res.json()) as { message?: { content?: string } };
    return parseAnalysis(data.message?.content ?? "", "ollama", model);
  } finally {
    clearTimeout(timer);
  }
}

async function callOpenAi(evidence: ProductEvidence): Promise<AiAnalysis> {
  const model = serverConfig.openAiModel;
  const res = await fetch("https://api.openai.com/v1/chat/completions", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${serverConfig.openAiApiKey}`,
    },
    signal: AbortSignal.timeout(serverConfig.llmTimeoutMs),
    body: JSON.stringify({
      model,
      messages: [
        { role: "system", content: SYSTEM_PROMPT },
        { role: "user", content: buildUserPrompt(evidence) },
      ],
      temperature: 0.3,
    }),
  });

  if (!res.ok) throw new Error(`OpenAI HTTP ${res.status}`);
  const data = (await res.json()) as { choices?: { message?: { content?: string } }[] };
  return parseAnalysis(data.choices?.[0]?.message?.content ?? "", "openai", model);
}

function templateAnalysis(evidence: ProductEvidence): AiAnalysis {
  const name = evidence.identity.name ?? evidence.ocr?.productName ?? "Prodotto";
  const sources = evidence.sources.filter((s) => s.status === "ok").map((s) => s.label);
  return {
    available: false,
    summary: `${name}: raccolte evidenze da ${sources.length} fonti (${sources.join(", ") || "nessuna"}). AI non disponibile — configura Ollama o OpenAI.`,
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

  try {
    if (serverConfig.aiProvider === "openai" && serverConfig.openAiApiKey) {
      return await callOpenAi(evidence);
    }
    if (serverConfig.aiProvider === "ollama" || !serverConfig.openAiApiKey) {
      return await callOllama(evidence);
    }
    return templateAnalysis(evidence);
  } catch (err) {
    const reason = err instanceof Error ? err.message : "Errore LLM";
    const base = templateAnalysis(evidence);
    return { ...base, reason };
  }
}

export async function checkOllamaLlmAvailable(): Promise<boolean> {
  try {
    const res = await fetch(`${serverConfig.ollamaBaseUrl}/api/tags`, {
      signal: AbortSignal.timeout(3000),
    });
    return res.ok;
  } catch {
    return false;
  }
}
