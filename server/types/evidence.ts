/** Evidenze raccolte da OCR, banche dati e inferenze */

export type SourceStatus = "ok" | "empty" | "error" | "skipped" | "not_configured";

export interface SourceEvidence {
  source: string;
  label: string;
  status: SourceStatus;
  data: Record<string, unknown>;
  ms?: number;
}

export interface OcrExtraction {
  rawText: string;
  barcode?: string;
  productName?: string;
  brand?: string;
  ingredients?: string;
  /** food | cosmetic | cleaning | unknown — inferito dal testo OCR */
  labelKind?: "food" | "cosmetic" | "cleaning" | "unknown";
  /** Avvisi qualità OCR (allucinazioni, tipo etichetta, ecc.) */
  warnings?: string[];
  originClaims: string[];
  labelClaims: string[];
  provider: string;
  model: string;
}

/** Analisi visiva da foto prodotto (confezione, aspetto, ecc.) */
export interface ProductVision {
  productName?: string;
  brand?: string;
  category?: string;
  description: string;
  visualCues: string[];
  provider: string;
  model: string;
}

export type TraceLevel = "verified" | "partial" | "unavailable";

export interface TraceItem {
  label: string;
  value?: string;
  level: TraceLevel;
  source?: string;
}

export interface IngredientOriginItem {
  ingredient: string;
  origin?: string;
  level: TraceLevel;
  source?: string;
  percentEstimate?: number;
}

export interface SupplyChainProfile {
  items: TraceItem[];
  ingredientOrigins: IngredientOriginItem[];
  overallLevel: TraceLevel;
  summary: string;
}

export interface StructuredIngredient {
  text: string;
  percentEstimate?: number;
  percentMin?: number;
  percentMax?: number;
}

export interface ProductEvidence {
  id: string;
  barcode?: string;
  /** Come è stato trovato il prodotto nelle banche dati */
  searchMethod?: "barcode" | "name" | "ocr_only" | "none";
  searchQuery?: string;
  identity: {
    name?: string;
    brand?: string;
    category?: string;
    imageUrl?: string;
  };
  composition?: {
    ingredients?: string;
    structured?: StructuredIngredient[];
  };
  geography: {
    countries: string[];
    origins: string[];
    manufacturing: string[];
    purchasePlaces: string[];
    originTags?: string[];
    manufacturingTags?: string[];
  };
  meta?: {
    sourceDatabase?: string;
    traceabilityCodes: string[];
    labels: string[];
  };
  certifications: Array<{ name: string; issuer: string; source: string }>;
  customs?: {
    hsCode?: string;
    country?: string;
    source?: string;
  };
  /** Profilo filiera: origine prodotto e ingredienti con livello di affidabilità */
  supplyChain?: SupplyChainProfile;
  gs1?: Record<string, unknown>;
  serp?: Record<string, unknown>;
  /** Risultati ricerca web Google (SerpApi) per arricchire sintesi AI */
  webSearch?: Record<string, unknown>;
  ocr?: OcrExtraction;
  productVision?: ProductVision;
  sources: SourceEvidence[];
}

export interface AiAnalysis {
  available: boolean;
  summary: string;
  transparencyLevel: "high" | "medium" | "low";
  verifiedFacts: string[];
  uncertainClaims: string[];
  conflicts: string[];
  provider?: string;
  model?: string;
  reason?: string;
}

export interface AnalyzeResponse {
  evidence: ProductEvidence;
  analysis: AiAnalysis;
}
