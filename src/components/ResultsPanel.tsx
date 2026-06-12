import type { AiAnalysis, ProductEvidence } from "../types/evidence";
import { DATABASE_CATALOG, mergeLampsFromEvidence } from "../lib/databaseCatalog";
import { Card } from "./Card";
import { DatabaseStatusGrid } from "./DatabaseStatusGrid";
import { ProductImage } from "./ProductImage";
import { ProductSummaryCard } from "./ProductSummaryCard";
import { TransparencyBadge } from "./TransparencyBadge";

const STATUS_COLOR = {
  ok: "text-emerald-400",
  empty: "text-slate-500",
  error: "text-rose-400",
  skipped: "text-slate-600",
  not_configured: "text-amber-400",
} as const;

interface Props {
  evidence: ProductEvidence;
  analysis: AiAnalysis;
}

export function ResultsPanel({ evidence, analysis }: Props) {
  return (
    <div className="space-y-4">
      <ProductSummaryCard evidence={evidence} />

      <Card title="Sintesi AI">
        <div className="mb-3 flex flex-wrap items-center gap-2">
          <TransparencyBadge level={analysis.transparencyLevel} />
          {analysis.provider && (
            <span className="text-xs text-slate-500">
              {analysis.provider} · {analysis.model}
            </span>
          )}
        </div>
        <p className="leading-relaxed text-slate-200">{analysis.summary}</p>
        {!analysis.available && analysis.reason && (
          <p className="mt-2 text-xs text-amber-400">{analysis.reason}</p>
        )}

        {analysis.verifiedFacts.length > 0 && (
          <div className="mt-4">
            <h3 className="mb-1 text-xs font-medium text-emerald-400">Verificato</h3>
            <ul className="list-inside list-disc text-sm text-slate-300">
              {analysis.verifiedFacts.map((f) => (
                <li key={f}>{f}</li>
              ))}
            </ul>
          </div>
        )}

        {analysis.uncertainClaims.length > 0 && (
          <div className="mt-3">
            <h3 className="mb-1 text-xs font-medium text-amber-400">Incerto</h3>
            <ul className="list-inside list-disc text-sm text-slate-400">
              {analysis.uncertainClaims.map((f) => (
                <li key={f}>{f}</li>
              ))}
            </ul>
          </div>
        )}

        {analysis.conflicts.length > 0 && (
          <div className="mt-3">
            <h3 className="mb-1 text-xs font-medium text-rose-400">Conflitti</h3>
            <ul className="list-inside list-disc text-sm text-rose-300">
              {analysis.conflicts.map((f) => (
                <li key={f}>{f}</li>
              ))}
            </ul>
          </div>
        )}
      </Card>

      <Card title="Identità prodotto">
        {evidence.searchMethod && (
          <p className="mb-3 rounded-lg bg-slate-950 px-2 py-1.5 text-xs text-slate-400">
            Ricerca:{" "}
            <SearchMethodLabel method={evidence.searchMethod} query={evidence.searchQuery} />
          </p>
        )}
        <dl className="grid gap-2 text-sm">
          <Row label="Nome" value={evidence.identity.name} />
          <Row label="Marca" value={evidence.identity.brand} />
          <Row label="Categoria" value={evidence.identity.category} />
          <Row label="Barcode" value={evidence.barcode} mono />
        </dl>
        <ProductImage
          url={evidence.identity.imageUrl}
          alt=""
          className="mt-3 max-h-40 rounded-lg border border-slate-700 object-contain"
        />
      </Card>

      {evidence.composition?.ingredients && (
        <Card title="Ingredienti">
          <p className="text-sm leading-relaxed text-slate-300">
            {evidence.composition.ingredients}
          </p>
        </Card>
      )}

      {(evidence.geography.countries.length > 0 ||
        evidence.geography.origins.length > 0) && (
        <Card title="Geografia filiera">
          <Row label="Paesi vendita" value={evidence.geography.countries.join(", ")} />
          <Row label="Origini" value={evidence.geography.origins.join(", ") || "—"} />
          <Row
            label="Produzione"
            value={evidence.geography.manufacturing.join(", ") || "—"}
          />
          {(evidence.geography.purchasePlaces?.length ?? 0) > 0 && (
            <Row
              label="Luoghi acquisto"
              value={evidence.geography.purchasePlaces.join(", ")}
            />
          )}
          {evidence.customs?.hsCode && (
            <Row
              label="Codice HS"
              value={`${evidence.customs.hsCode}${evidence.customs.country ? ` · ${evidence.customs.country}` : ""}`}
            />
          )}
        </Card>
      )}

      {evidence.certifications.length > 0 && (
        <Card title="Certificazioni / claim">
          <ul className="flex flex-wrap gap-2">
            {evidence.certifications.map((c) => (
              <li
                key={`${c.source}-${c.name}`}
                className="rounded-full bg-slate-800 px-3 py-1 text-xs text-slate-300"
              >
                {c.name}
              </li>
            ))}
          </ul>
        </Card>
      )}

      {evidence.serp && Array.isArray(evidence.serp.shopping_results) && (
        <Card title="Google Shopping (SerpApi)">
          <ul className="space-y-2 text-sm">
            {(evidence.serp.shopping_results as { title?: string; seller?: string; price?: string }[]).map(
              (item, i) => (
                <li key={i} className="rounded-lg bg-slate-950 px-3 py-2 text-slate-300">
                  <span className="text-slate-200">{item.title}</span>
                  {item.seller && (
                    <span className="ml-2 text-xs text-slate-500">· {item.seller}</span>
                  )}
                  {item.price && (
                    <span className="ml-2 text-xs text-emerald-400">{item.price}</span>
                  )}
                </li>
              ),
            )}
          </ul>
        </Card>
      )}

      {evidence.gs1 && evidence.gs1.product_description && (
        <Card title="GS1 / Barcode lookup">
          <p className="text-sm text-slate-300">{String(evidence.gs1.product_description)}</p>
          <p className="mt-1 text-xs text-slate-500">{String(evidence.gs1.note ?? "")}</p>
        </Card>
      )}

      <Card title="Fonti consultate">
        <DatabaseStatusGrid
          lamps={mergeLampsFromEvidence(
            DATABASE_CATALOG.map((d) => ({ id: d.id, status: "idle" })),
            evidence.sources,
          )}
          compact
        />
        <ul className="mt-3 space-y-2 border-t border-slate-800 pt-3">
          {evidence.sources.map((s) => (
            <li
              key={s.source}
              className="flex items-center justify-between text-sm"
            >
              <span className="text-slate-300">{s.label}</span>
              <span className={`font-medium ${STATUS_COLOR[s.status]}`}>
                {s.status}
                {s.ms != null ? ` · ${s.ms}ms` : ""}
              </span>
            </li>
          ))}
        </ul>
      </Card>
    </div>
  );
}

function SearchMethodLabel({
  method,
  query,
}: {
  method: NonNullable<ProductEvidence["searchMethod"]>;
  query?: string;
}) {
  const labels = {
    barcode: "barcode EAN",
    name: `nome prodotto${query ? ` («${query}»)` : ""}`,
    ocr_only: "solo testo OCR (nessun match DB)",
    none: "nessuna",
  };
  return <span className="text-slate-200">{labels[method]}</span>;
}

function Row({
  label,
  value,
  mono,
}: {
  label: string;
  value?: string;
  mono?: boolean;
}) {
  if (!value) return null;
  return (
    <div>
      <dt className="text-xs text-slate-500">{label}</dt>
      <dd className={`text-slate-200 ${mono ? "font-mono" : ""}`}>{value}</dd>
    </div>
  );
}
