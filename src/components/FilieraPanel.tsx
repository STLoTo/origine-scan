import type { IngredientOriginItem, SupplyChainProfile, TraceItem, TraceLevel } from "../types/evidence";
import { Card } from "./Card";

const LEVEL_STYLE: Record<
  TraceLevel,
  { badge: string; label: string; dot: string }
> = {
  verified: {
    badge: "bg-emerald-500/15 text-emerald-300 ring-emerald-500/30",
    label: "Verificato",
    dot: "bg-emerald-400",
  },
  partial: {
    badge: "bg-amber-500/15 text-amber-200 ring-amber-500/30",
    label: "Parziale",
    dot: "bg-amber-400",
  },
  unavailable: {
    badge: "bg-slate-800 text-slate-500 ring-slate-700",
    label: "Non disponibile",
    dot: "bg-slate-600",
  },
};

interface Props {
  profile: SupplyChainProfile;
}

export function FilieraPanel({ profile }: Props) {
  const geoItems = profile.items.filter((i) => !i.label.startsWith("Lista ingredienti"));

  return (
    <Card title="Filiera — origine prodotto e ingredienti">
      <div className="mb-4 flex flex-wrap items-center gap-2">
        <LevelBadge level={profile.overallLevel} />
        <p className="text-sm text-slate-400">{profile.summary}</p>
      </div>

      {geoItems.length > 0 && (
        <section className="mb-4">
          <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-slate-500">
            Geografia e tracciabilità
          </h3>
          <ul className="space-y-2">
            {geoItems.map((item) => (
              <TraceRow key={`${item.label}-${item.value}`} item={item} />
            ))}
          </ul>
        </section>
      )}

      {profile.ingredientOrigins.length > 0 && (
        <section>
          <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-slate-500">
            Ingredienti e origine
          </h3>
          <div className="overflow-x-auto">
            <table className="w-full min-w-[280px] text-left text-sm">
              <thead>
                <tr className="border-b border-slate-800 text-xs text-slate-500">
                  <th className="py-2 pr-3 font-medium">Ingrediente</th>
                  <th className="py-2 pr-3 font-medium">Origine</th>
                  <th className="py-2 font-medium">Affidabilità</th>
                </tr>
              </thead>
              <tbody>
                {profile.ingredientOrigins.slice(0, 20).map((row) => (
                  <IngredientRow key={row.ingredient} row={row} />
                ))}
              </tbody>
            </table>
          </div>
          {profile.ingredientOrigins.length > 20 && (
            <p className="mt-2 text-xs text-slate-500">
              Mostrati 20 di {profile.ingredientOrigins.length} ingredienti.
            </p>
          )}
        </section>
      )}

      {geoItems.length === 0 && profile.ingredientOrigins.length === 0 && (
        <p className="text-sm text-slate-500">
          Nessun dato filiera disponibile. Serve un match EAN su Open Facts o claim origine leggibili
          sull&apos;etichetta (es. «Prodotto in Italia», «Origine del riso: India»).
        </p>
      )}
    </Card>
  );
}

function TraceRow({ item }: { item: TraceItem }) {
  return (
    <li className="rounded-lg bg-slate-950 px-3 py-2">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="min-w-0 flex-1">
          <p className="text-xs text-slate-500">{item.label}</p>
          <p className="text-sm text-slate-200">{item.value ?? "—"}</p>
          {item.source && <p className="mt-0.5 text-xs text-slate-600">Fonte: {item.source}</p>}
        </div>
        <LevelBadge level={item.level} compact />
      </div>
    </li>
  );
}

function IngredientRow({ row }: { row: IngredientOriginItem }) {
  const pct =
    row.percentEstimate != null ? ` (~${Math.round(row.percentEstimate)}%)` : "";
  return (
    <tr className="border-b border-slate-900/80">
      <td className="py-2 pr-3 text-slate-200">
        {row.ingredient}
        {pct && <span className="text-xs text-slate-500">{pct}</span>}
      </td>
      <td className="py-2 pr-3 text-slate-300">{row.origin ?? "—"}</td>
      <td className="py-2">
        <LevelBadge level={row.origin ? row.level : "unavailable"} compact />
      </td>
    </tr>
  );
}

function LevelBadge({ level, compact }: { level: TraceLevel; compact?: boolean }) {
  const style = LEVEL_STYLE[level];
  return (
    <span
      className={`inline-flex items-center gap-1.5 rounded-full px-2 py-0.5 text-xs ring-1 ${style.badge} ${compact ? "shrink-0" : ""}`}
    >
      <span className={`h-1.5 w-1.5 rounded-full ${style.dot}`} />
      {style.label}
    </span>
  );
}
