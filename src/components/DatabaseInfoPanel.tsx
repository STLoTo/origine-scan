import { useState } from "react";
import { DATABASE_INFO, DATABASE_INTRO, formatSearchBy } from "../lib/databaseInfo";
import { LAMP_STYLE, type DatabaseLampStatus } from "../lib/databaseCatalog";

const LAMP_LEGEND: DatabaseLampStatus[] = [
  "online",
  "ok",
  "empty",
  "skipped",
  "offline",
  "not_configured",
];

export function DatabaseInfoPanel() {
  const [open, setOpen] = useState(false);
  const [expandedId, setExpandedId] = useState<string | null>(null);

  return (
    <div className="mt-4 border-t border-slate-800 pt-4">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="flex w-full items-center justify-between rounded-lg px-2 py-2 text-left text-sm text-slate-300 transition hover:bg-slate-800/60"
        aria-expanded={open}
      >
        <span className="flex items-center gap-2">
          <span className="flex h-5 w-5 items-center justify-center rounded-full bg-sky-500/20 text-xs text-sky-400">
            i
          </span>
          Guida banche dati — cosa contengono e come si interrogano
        </span>
        <span className="text-slate-500">{open ? "▲" : "▼"}</span>
      </button>

      {open && (
        <div className="mt-3 space-y-4">
          <section className="rounded-xl border border-slate-800 bg-slate-950/80 p-3 text-sm leading-relaxed text-slate-400">
            <p className="font-medium text-slate-300">Introduzione</p>
            <p className="mt-2">{DATABASE_INTRO}</p>
          </section>

          <section className="rounded-xl bg-slate-950/80 p-3 text-xs leading-relaxed text-slate-400">
            <p className="font-medium text-slate-300">Flusso analisi</p>
            <ol className="mt-2 list-decimal space-y-1 pl-4">
              <li>
                <strong className="text-slate-300">Foto etichetta</strong> → OCR estrae testo,
                barcode, nome, ingredienti
              </li>
              <li>
                <strong className="text-slate-300">Con EAN</strong> → Open Facts (OFF/OBF/OPF),
                GS1, certificazioni, dogana
              </li>
              <li>
                <strong className="text-slate-300">Senza EAN</strong> → ricerca per nome su Open
                Facts; GS1 e dogana saltati
              </li>
              <li>
                <strong className="text-slate-300">SerpApi</strong> → sempre per nome prodotto (se
                configurata)
              </li>
              <li>
                Tutte le evidenze vengono unite in <strong className="text-slate-300">ProductEvidence</strong>{" "}
                e sintetizzate dall&apos;AI
              </li>
            </ol>
          </section>

          <section>
            <p className="mb-2 text-xs font-medium text-slate-400">Legenda stato collegamento</p>
            <div className="flex flex-wrap gap-2">
              {LAMP_LEGEND.map((status) => (
                <span
                  key={status}
                  className={`inline-flex items-center gap-1.5 rounded-full border px-2 py-0.5 text-[10px] text-slate-400 ${LAMP_STYLE[status].ring}`}
                >
                  <span className={`h-1.5 w-1.5 rounded-full ${LAMP_STYLE[status].dot}`} />
                  {LAMP_STYLE[status].label}
                </span>
              ))}
            </div>
          </section>

          <ul className="space-y-2">
            {DATABASE_INFO.map((db) => {
              const isExpanded = expandedId === db.id;
              return (
                <li
                  key={db.id}
                  className="overflow-hidden rounded-xl border border-slate-800 bg-slate-950/50"
                >
                  <button
                    type="button"
                    onClick={() => setExpandedId(isExpanded ? null : db.id)}
                    className="flex w-full items-start gap-3 p-3 text-left transition hover:bg-slate-900/80"
                    aria-expanded={isExpanded}
                  >
                    <span
                      className="mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-[10px] font-bold"
                      style={{
                        backgroundColor: `${db.color}22`,
                        color: db.color,
                        border: `1px solid ${db.color}`,
                      }}
                    >
                      {db.short}
                    </span>
                    <div className="min-w-0 flex-1">
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="text-sm font-medium text-slate-200">{db.label}</span>
                        <span className="rounded bg-slate-800 px-1.5 py-0.5 text-[10px] text-slate-400">
                          {formatSearchBy(db.searchBy)}
                        </span>
                        {db.envKey && (
                          <span className="rounded bg-amber-500/10 px-1.5 py-0.5 text-[10px] text-amber-400">
                            {db.envKey}
                          </span>
                        )}
                      </div>
                      <p className="mt-1 text-xs text-slate-500">{db.summary}</p>
                    </div>
                    <span className="shrink-0 text-xs text-slate-600">{isExpanded ? "−" : "+"}</span>
                  </button>

                  {isExpanded && (
                    <div className="border-t border-slate-800 px-3 pb-3 pt-2 text-xs text-slate-400">
                      <p className="mb-1 font-medium text-slate-300">Cosa contiene</p>
                      <ul className="mb-3 list-disc space-y-0.5 pl-4">
                        {db.contains.map((item) => (
                          <li key={item}>{item}</li>
                        ))}
                      </ul>
                      <p className="mb-1 font-medium text-slate-300">Come si interroga</p>
                      <p className="mb-2">{db.queryHint}</p>
                      {db.note && (
                        <p className="rounded-lg bg-slate-900/80 px-2 py-1.5 text-slate-500">
                          <span className="text-slate-400">Nota: </span>
                          {db.note}
                        </p>
                      )}
                    </div>
                  )}
                </li>
              );
            })}
          </ul>

          <p className="text-[10px] leading-relaxed text-slate-600">
            OrigineScan non memorizza un database locale: interroga API esterne in tempo reale e
            aggrega i risultati. Nessun dato viene salvato sul server dopo l&apos;analisi.
          </p>
        </div>
      )}
    </div>
  );
}
