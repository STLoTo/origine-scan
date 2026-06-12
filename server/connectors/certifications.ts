import type { FlatOpenProduct } from "../lib/openFactsClient";

const CERT_KEYWORDS = [
  "bio",
  "organic",
  "fsc",
  "gots",
  "fair-trade",
  "dop",
  "igp",
  "pdo",
  "cruelty-free",
  "vegan",
  "rainforest-alliance",
  "ecolabel",
  "eu-ecolabel",
  "dermatologically",
  "paraben",
  "biodegradable",
  "oeko-tex",
  "fair-wear",
  "made-in-italy",
];

/** Estrae certificazioni da labels/tags Open Facts */
export function extractCertifications(
  openProduct?: FlatOpenProduct | null,
): Record<string, unknown> {
  const tags = [
    ...(openProduct?.labels_tags ?? []),
    ...(openProduct?.labels?.split(",") ?? []),
  ]
    .map((t) => t.toLowerCase().trim())
    .filter(Boolean);

  const certifications = tags
    .filter((tag) => CERT_KEYWORDS.some((kw) => tag.includes(kw)))
    .map((tag) => ({
      name: tag.replace(/-/g, " ").replace(/^en:/, ""),
      issuer: "Open Facts labels",
      source: "open_facts_labels",
    }));

  return { certifications };
}
