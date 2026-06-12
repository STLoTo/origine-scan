import type { DatabaseLampStatus } from "../lib/databaseCatalog";

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
  originClaims: string[];
  labelClaims: string[];
  provider: string;
  model: string;
}

export interface ProductVision {
  productName?: string;
  brand?: string;
  category?: string;
  description: string;
  visualCues: string[];
  provider: string;
  model: string;
}

export interface ProductEvidence {
  id: string;
  barcode?: string;
  searchMethod?: "barcode" | "name" | "ocr_only" | "none";
  searchQuery?: string;
  identity: {
    name?: string;
    brand?: string;
    category?: string;
    imageUrl?: string;
  };
  composition?: { ingredients?: string };
  geography: {
    countries: string[];
    origins: string[];
    manufacturing: string[];
  };
  certifications: Array<{ name: string; issuer: string; source: string }>;
  customs?: { hsCode?: string; country?: string; source?: string };
  gs1?: Record<string, unknown>;
  serp?: Record<string, unknown>;
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

export interface HealthResponse {
  status: string;
  infomaniak: {
    configured: boolean;
    ocrAvailable: boolean;
    llmAvailable: boolean;
    visionModel: string;
    llmModel: string;
    visionFallbackModel?: string;
  };
  aiProvider: string;
  databases?: DatabaseLamp[];
}

export interface DatabasesStatusResponse {
  databases: DatabaseLamp[];
}

export interface DatabaseLamp {
  id: string;
  status: DatabaseLampStatus;
  ms?: number;
  detail?: string;
}
