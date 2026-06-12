import type { ReactNode } from "react";
import type { ProductEvidence } from "../types/evidence";
import { DATABASE_CATALOG } from "../lib/databaseCatalog";
import { Card } from "./Card";
import { ProductImage } from "./ProductImage";

interface Props {
  evidence: ProductEvidence;
}

/** Formatta tag Open Facts (es. en:france → France) */
function formatTag(value: string): string {
  const cleaned = value.replace(/^[^:]+:\s*/, "").replace(/_/g, " ").trim();
  return cleaned.charAt(0).toUpperCase() + cleaned.slice(1);
}

function formatList(values: string[]): string | undefined {
  const unique = [...new Set(values.map(formatTag).filter(Boolean))];
  return unique.length ? unique.join(", ") : undefined;
}

function databaseLabel(id?: string): string | undefined {
  if (!id) return undefined;
  return DATABASE_CATALOG.find((d) => d.id === id)?.label ?? id.replace(/_/g, " ");
}

export function ProductSummaryCard({ evidence }: Props) {
  const { identity, composition, geography, certifications, customs, gs1, meta } = evidence;

  const ingredients = composition?.ingredients?.trim();
  const countries = formatList(geography.countries);
  const origins = formatList(geography.origins);
  const manufacturing = formatList(geography.manufacturing);
  const purchasePlaces = formatList(geography.purchasePlaces ?? []);
  const labels = meta?.labels?.length ? formatList(meta.labels) : undefined;
  const traceability = meta?.traceabilityCodes?.length
    ? formatList(meta.traceabilityCodes)
    : undefined;

  const gs1Description =
    gs1?.product_description != null ? String(gs1.product_description) : undefined;
  const gs1Company = gs1?.company_name != null ? String(gs1.company_name) : undefined;

  const okSources = evidence.sources.filter((s) => s.status === "ok");
  const rejectedDbMatch = evidence.sources.find((s) => s.source === "open_facts_rejected");

  const hasGeo =
    countries || origins || manufacturing || purchasePlaces || customs?.hsCode;
  const hasContent =
    identity.name ||
    identity.brand ||
    ingredients ||
    hasGeo ||
    certifications.length > 0 ||
    labels ||
    traceability ||
    gs1Description;

  if (!hasContent) return null;

  return (
    <Card title="Scheda prodotto" className="border-emerald-500/30 bg-gradient-to-br from-slate-900/90 to-emerald-950/20">
      {rejectedDbMatch && (
        <div className="mb-4 rounded-lg border border-amber-500/40 bg-amber-500/10 px-3 py-2 text-sm text-amber-200">
          {String(rejectedDbMatch.data.note ?? "Match banca dati non coerente con l'etichetta.")}
          {rejectedDbMatch.data.attemptedProduct != null && (
            <span className="mt-1 block text-xs text-amber-300/90">
              Trovato in DB: {String(rejectedDbMatch.data.attemptedProduct)}
            </span>
          )}
        </div>
      )}
      <div className="flex flex-col gap-4 sm:flex-row sm:items-start">
        <ProductImage
          url={identity.imageUrl}
          alt={identity.name ?? "Prodotto"}
          className="mx-auto h-32 w-32 shrink-0 rounded-xl border border-slate-700 object-contain sm:mx-0"
        />
        <div className="min-w-0 flex-1">
          {identity.name && (
            <h3 className="text-lg font-semibold leading-snug text-slate-100">{identity.name}</h3>
          )}
          <dl className="mt-2 grid gap-1.5 text-sm">
            {identity.brand && (
              <SummaryRow label="Marca" value={identity.brand} />
            )}
            {identity.category && (
              <SummaryRow label="Categoria" value={formatTag(identity.category)} />
            )}
            {evidence.barcode && (
              <SummaryRow label="Barcode" value={evidence.barcode} mono />
            )}
            {meta?.sourceDatabase && (
              <SummaryRow label="Banca dati" value={databaseLabel(meta.sourceDatabase)} />
            )}
          </dl>
        </div>
      </div>

      <div className="mt-4 space-y-4 border-t border-slate-800 pt-4">
        {ingredients && (
          <SummarySection title="Ingredienti">
            <p className="text-sm leading-relaxed text-slate-300">{ingredients}</p>
          </SummarySection>
        )}

        {hasGeo && (
          <SummarySection title="Provenienza e produzione">
            <dl className="grid gap-2 text-sm">
              {origins && <SummaryRow label="Origine ingredienti / materie prime" value={origins} />}
              {manufacturing && <SummaryRow label="Luogo di produzione" value={manufacturing} />}
              {countries && <SummaryRow label="Paesi di vendita" value={countries} />}
              {purchasePlaces && <SummaryRow label="Luoghi di acquisto registrati" value={purchasePlaces} />}
              {customs?.hsCode && (
                <SummaryRow
                  label="Codice doganale (HS)"
                  value={`${customs.hsCode}${customs.country ? ` · ultimo import: ${formatTag(customs.country)}` : ""}`}
                />
              )}
            </dl>
          </SummarySection>
        )}

        {(certifications.length > 0 || labels) && (
          <SummarySection title="Certificazioni e etichette">
            {certifications.length > 0 && (
              <ul className="mb-2 flex flex-wrap gap-2">
                {certifications.map((c) => (
                  <li
                    key={`${c.source}-${c.name}`}
                    className="rounded-full bg-emerald-500/10 px-3 py-1 text-xs text-emerald-300 ring-1 ring-emerald-500/30"
                    title={`Fonte: ${c.issuer}`}
                  >
                    {c.name}
                  </li>
                ))}
              </ul>
            )}
            {labels && !certifications.length && (
              <p className="text-sm text-slate-300">{labels}</p>
            )}
          </SummarySection>
        )}

        {traceability && (
          <SummarySection title="Tracciabilità">
            <p className="text-sm text-slate-300">{traceability}</p>
          </SummarySection>
        )}

        {(gs1Description || gs1Company) && (
          <SummarySection title="GS1 / Registro barcode">
            <dl className="grid gap-2 text-sm">
              {gs1Company && <SummaryRow label="Azienda registrata" value={gs1Company} />}
              {gs1Description && <SummaryRow label="Descrizione" value={gs1Description} />}
            </dl>
          </SummarySection>
        )}

        {evidence.ocr?.originClaims && evidence.ocr.originClaims.length > 0 && (
          <SummarySection title="Claim origine (da etichetta OCR)">
            <ul className="list-inside list-disc text-sm text-slate-300">
              {evidence.ocr.originClaims.map((claim) => (
                <li key={claim}>{claim}</li>
              ))}
            </ul>
          </SummarySection>
        )}

        {okSources.length > 0 && (
          <SummarySection title="Fonti con dati">
            <ul className="flex flex-wrap gap-2">
              {okSources.map((s) => (
                <li
                  key={s.source}
                  className="rounded-lg bg-slate-950 px-2.5 py-1 text-xs text-slate-400"
                >
                  {s.label}
                  {s.ms != null && <span className="text-slate-600"> · {s.ms}ms</span>}
                </li>
              ))}
            </ul>
          </SummarySection>
        )}
      </div>
    </Card>
  );
}

function SummarySection({
  title,
  children,
}: {
  title: string;
  children: ReactNode;
}) {
  return (
    <div>
      <h4 className="mb-2 text-xs font-semibold uppercase tracking-wide text-emerald-400/90">
        {title}
      </h4>
      {children}
    </div>
  );
}

function SummaryRow({
  label,
  value,
  mono,
}: {
  label: string;
  value: string;
  mono?: boolean;
}) {
  return (
    <div>
      <dt className="text-xs text-slate-500">{label}</dt>
      <dd className={`text-slate-200 ${mono ? "font-mono text-xs" : ""}`}>{value}</dd>
    </div>
  );
}
