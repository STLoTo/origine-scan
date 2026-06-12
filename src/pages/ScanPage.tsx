import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import {
  analyzeBarcode,
  analyzeFromOcr,
  assertUploadBudget,
  fetchDatabasesStatus,
  fetchHealth,
  lampsForAnalyzeStep,
  MAX_SCAN_PHOTOS,
  mergeLampsFromEvidence,
  ocrLabel,
  runFullAnalysis,
} from "../api/client";
import { defaultDatabaseLamps } from "../lib/databaseCatalog";
import { resizeImageForOcr } from "../lib/resizeImage";
import type { AnalyzeResponse, DatabaseLamp, HealthResponse, OcrExtraction } from "../types/evidence";
import { Card } from "../components/Card";
import { DatabaseInfoPanel } from "../components/DatabaseInfoPanel";
import { DatabaseStatusGrid } from "../components/DatabaseStatusGrid";
import { ResultsPanel } from "../components/ResultsPanel";
import { DATABASE_INTRO_SHORT } from "../lib/databaseInfo";

type Step = "idle" | "ocr" | "analyze" | "done" | "error";

interface ScanPhoto {
  id: string;
  file: File;
  preview: string;
}

export function ScanPage() {
  const cameraRef = useRef<HTMLInputElement>(null);
  const galleryRef = useRef<HTMLInputElement>(null);

  const [photos, setPhotos] = useState<ScanPhoto[]>([]);
  const [barcode, setBarcode] = useState("");
  const [ocr, setOcr] = useState<OcrExtraction | null>(null);
  const [result, setResult] = useState<AnalyzeResponse | null>(null);
  const [step, setStep] = useState<Step>("idle");
  const [error, setError] = useState<string | null>(null);
  const [health, setHealth] = useState<HealthResponse | null>(null);
  const [dbLamps, setDbLamps] = useState<DatabaseLamp[]>(() => defaultDatabaseLamps("loading"));
  const [dbLoadError, setDbLoadError] = useState<string | null>(null);

  useEffect(() => {
    setDbLoadError(null);
    setDbLamps(defaultDatabaseLamps("loading"));

    void fetchHealth()
      .then((h) => {
        setHealth(h);
        if (h.databases?.length) setDbLamps(h.databases);
      })
      .catch(() => setHealth(null));

    void fetchDatabasesStatus()
      .then((lamps) => {
        if (lamps.length) setDbLamps(lamps);
        setDbLoadError(null);
      })
      .catch((err: unknown) => {
        const message =
          err instanceof Error ? err.message : "Impossibile verificare le banche dati";
        setDbLoadError(message);
        setDbLamps(defaultDatabaseLamps("offline", "API non raggiungibile"));
      });
  }, []);

  useEffect(() => {
    return () => {
      photos.forEach((p) => URL.revokeObjectURL(p.preview));
    };
  }, [photos]);

  const addPhotos = useCallback(async (files: FileList | File[]) => {
    const list = Array.from(files).filter((f) => f.type.startsWith("image/"));
    if (!list.length) return;

    const optimized = await Promise.all(list.map((f) => resizeImageForOcr(f)));

    setPhotos((prev) => {
      const slots = MAX_SCAN_PHOTOS - prev.length;
      if (slots <= 0) return prev;

      const toAdd = optimized.slice(0, slots);
      return [
        ...prev,
        ...toAdd.map((f) => ({
          id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
          file: f,
          preview: URL.createObjectURL(f),
        })),
      ];
    });
    setOcr(null);
    setResult(null);
    setError(null);
    setStep("idle");
  }, []);

  const removePhoto = useCallback((id: string) => {
    setPhotos((prev) => {
      const removed = prev.find((p) => p.id === id);
      if (removed) URL.revokeObjectURL(removed.preview);
      return prev.filter((p) => p.id !== id);
    });
    setOcr(null);
    setResult(null);
  }, []);

  const canAnalyze = Boolean(photos.length || barcode.trim() || ocr);
  const slotsLeft = MAX_SCAN_PHOTOS - photos.length;

  async function handleOcrOnly() {
    if (!photos.length) return;
    setStep("ocr");
    setError(null);
    try {
      const extracted = await ocrLabel(photos[0]!.file);
      setOcr(extracted);
      if (extracted.barcode) setBarcode(extracted.barcode);
      setStep("done");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Errore OCR");
      setStep("error");
    }
  }

  async function handleFullAnalyze() {
    setStep("analyze");
    setError(null);
    setDbLamps(lampsForAnalyzeStep());
    try {
      let response: AnalyzeResponse;
      const imageFiles = photos.map((p) => p.file);
      assertUploadBudget(imageFiles);

      if (imageFiles.length) {
        response = await runFullAnalysis({
          imageFiles,
          ocr,
          barcode: barcode.trim() || ocr?.barcode,
        });
        setOcr(response.evidence.ocr ?? null);
        if (response.evidence.barcode) setBarcode(response.evidence.barcode);
      } else if (ocr) {
        response = await analyzeFromOcr(ocr, barcode || undefined);
      } else if (barcode.trim()) {
        response = await analyzeBarcode(barcode.trim());
      } else {
        throw new Error("Aggiungi almeno una foto o inserisci un barcode");
      }

      setResult(response);
      setDbLamps((prev) => mergeLampsFromEvidence(prev, response.evidence.sources));
      setStep("done");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Errore analisi");
      setStep("error");
      fetchDatabasesStatus().then(setDbLamps).catch(() => undefined);
    }
  }

  const busy = step === "ocr" || step === "analyze";

  return (
    <div className="mx-auto min-h-screen max-w-5xl px-4 py-6">
      <header className="mb-8">
        <h1 className="text-2xl font-bold tracking-tight text-white">OrigineScan</h1>
        <p className="mt-1 text-sm text-slate-400">
          Foto prodotto · OCR · banche dati · analisi AI trasparenza filiera
        </p>
        {health && (
          <div className="mt-3 flex flex-wrap gap-2 text-xs">
            <Badge ok={health.infomaniak.ocrAvailable} label={`OCR ${health.infomaniak.visionModel}`} />
            <Badge ok={health.infomaniak.llmAvailable} label={`LLM ${health.infomaniak.llmModel}`} />
          </div>
        )}
      </header>

      <Card title="Banche dati — stato collegamento" className="mb-6">
        <p className="mb-4 text-sm leading-relaxed text-slate-400">{DATABASE_INTRO_SHORT}</p>
        {dbLoadError && (
          <div className="mb-3 rounded-lg border border-rose-500/40 bg-rose-500/10 px-3 py-2 text-xs text-rose-300">
            {dbLoadError} — controlla che l&apos;API Vercel sia attiva e che le variabili d&apos;ambiente
            siano configurate.
          </div>
        )}
        <DatabaseStatusGrid lamps={dbLamps} />
        <DatabaseInfoPanel />
      </Card>

      <div className="grid gap-6 lg:grid-cols-2">
        <div className="space-y-4">
          <Card title="Foto prodotto">
            <p className="mb-3 text-xs leading-relaxed text-slate-500">
              Aggiungi fino a {MAX_SCAN_PHOTOS} foto: etichetta, ingredienti, fronte confezione, barcode.
              La <strong className="text-slate-400">prima foto</strong> viene usata per l&apos;OCR testo;
              tutte le foto aiutano l&apos;AI a riconoscere il prodotto.
            </p>

            <input
              ref={cameraRef}
              type="file"
              accept="image/*"
              capture="environment"
              className="hidden"
              onChange={(e) => {
                const files = e.target.files;
                if (files?.length) void addPhotos(files);
                e.target.value = "";
              }}
            />
            <input
              ref={galleryRef}
              type="file"
              accept="image/*"
              multiple
              className="hidden"
              onChange={(e) => {
                const files = e.target.files;
                if (files?.length) void addPhotos(files);
                e.target.value = "";
              }}
            />

            {photos.length > 0 ? (
              <div className="mb-3 grid grid-cols-3 gap-2 sm:grid-cols-4">
                {photos.map((photo, index) => (
                  <div
                    key={photo.id}
                    className="relative aspect-square overflow-hidden rounded-lg border border-slate-700 bg-slate-900"
                  >
                    <img
                      src={photo.preview}
                      alt={index === 0 ? "Foto principale OCR" : `Foto ${index + 1}`}
                      className="h-full w-full object-cover"
                    />
                    {index === 0 && (
                      <span className="absolute bottom-1 left-1 rounded bg-emerald-600/90 px-1.5 py-0.5 text-[10px] font-medium text-white">
                        OCR
                      </span>
                    )}
                    <button
                      type="button"
                      onClick={() => removePhoto(photo.id)}
                      className="absolute right-1 top-1 flex h-6 w-6 items-center justify-center rounded-full bg-black/70 text-xs text-white"
                      aria-label="Rimuovi foto"
                    >
                      ×
                    </button>
                  </div>
                ))}
                {slotsLeft > 0 && (
                  <button
                    type="button"
                    onClick={() => galleryRef.current?.click()}
                    disabled={busy}
                    className="flex aspect-square flex-col items-center justify-center rounded-lg border-2 border-dashed border-slate-700 bg-slate-900/50 text-slate-500 transition hover:border-emerald-500/40 hover:text-slate-400 disabled:opacity-40"
                  >
                    <span className="text-2xl">+</span>
                    <span className="mt-1 text-[10px]">Aggiungi</span>
                  </button>
                )}
              </div>
            ) : (
              <button
                type="button"
                onClick={() => galleryRef.current?.click()}
                disabled={busy}
                className="mb-3 flex min-h-[160px] w-full flex-col items-center justify-center rounded-xl border-2 border-dashed border-slate-700 bg-slate-900/50 transition hover:border-emerald-500/50 hover:bg-slate-900 disabled:opacity-40"
              >
                <span className="text-4xl">📷</span>
                <span className="mt-2 text-sm text-slate-400">Tocca per aggiungere foto</span>
              </button>
            )}

            <div className="flex flex-wrap gap-2">
              <Btn
                onClick={() => cameraRef.current?.click()}
                disabled={busy || slotsLeft <= 0}
                variant="secondary"
                className="flex-1 sm:flex-none"
              >
                📷 Scatta foto
              </Btn>
              <Btn
                onClick={() => galleryRef.current?.click()}
                disabled={busy || slotsLeft <= 0}
                variant="secondary"
                className="flex-1 sm:flex-none"
              >
                {photos.length ? "Da galleria" : "Carica foto"}
              </Btn>
            </div>

            {slotsLeft <= 0 && (
              <p className="mt-2 text-xs text-amber-400">
                Limite di {MAX_SCAN_PHOTOS} foto raggiunto. Rimuovi una foto per aggiungerne altre.
              </p>
            )}

            <div className="mt-4 flex flex-wrap gap-2 border-t border-slate-800 pt-4">
              <Btn onClick={handleOcrOnly} disabled={!photos.length || busy} variant="secondary">
                {step === "ocr" ? "Estrazione testo…" : "Solo OCR"}
              </Btn>
              <Btn onClick={handleFullAnalyze} disabled={busy || !canAnalyze}>
                {step === "analyze" ? "Analisi in corso…" : "Analizza completo"}
              </Btn>
            </div>
          </Card>

          <Card title="Barcode (opzionale)">
            <input
              type="text"
              inputMode="numeric"
              placeholder="EAN-13 es. 3017624010701"
              value={barcode}
              onChange={(e) => setBarcode(e.target.value)}
              className="w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 font-mono text-sm outline-none focus:border-emerald-500"
            />
            <p className="mt-2 text-xs text-slate-500">
              Se l&apos;OCR rileva un barcode, interroga automaticamente le banche dati.
            </p>
          </Card>

          {ocr && (
            <Card title="Testo estratto (OCR)">
              <dl className="mb-3 grid gap-2 text-sm">
                {ocr.labelKind && ocr.labelKind !== "unknown" && (
                  <Meta
                    label="Tipo etichetta"
                    value={
                      ocr.labelKind === "cleaning"
                        ? "Detergente / igienizzante"
                        : ocr.labelKind === "cosmetic"
                          ? "Cosmetico"
                          : "Alimentare"
                    }
                  />
                )}
                {ocr.productName && <Meta label="Nome" value={ocr.productName} />}
                {ocr.brand && <Meta label="Marca" value={ocr.brand} />}
                {ocr.barcode && <Meta label="Barcode" value={ocr.barcode} mono />}
              </dl>
              {ocr.warnings && ocr.warnings.length > 0 && (
                <ul className="mb-3 space-y-1 rounded-lg border border-amber-500/30 bg-amber-500/10 px-3 py-2 text-xs text-amber-200">
                  {ocr.warnings.map((w) => (
                    <li key={w}>⚠ {w}</li>
                  ))}
                </ul>
              )}
              <pre className="max-h-48 overflow-auto whitespace-pre-wrap rounded-lg bg-slate-950 p-3 text-xs leading-relaxed text-slate-300">
                {ocr.rawText}
              </pre>
              {ocr.ingredients && (
                <p className="mt-2 text-xs text-slate-400">
                  <span className="text-slate-500">Ingredienti (estratto): </span>
                  {ocr.ingredients.length > 400 ? `${ocr.ingredients.slice(0, 400)}…` : ocr.ingredients}
                </p>
              )}
              {!ocr.productName && !ocr.brand && (
                <p className="mt-2 text-xs text-amber-400">
                  Nome/marca non rilevati — aggiungi una foto del fronte confezione (come prima o seconda
                  immagine).
                </p>
              )}
              {ocr.barcode ? (
                <p className="mt-2 text-xs text-emerald-400">
                  Barcode rilevato: verranno interrogati Open Facts, GS1, certificazioni e dogana.
                </p>
              ) : (
                <p className="mt-2 text-xs text-amber-400">
                  Nessun barcode — verrà tentata ricerca per <strong>nome prodotto</strong> su Open Facts
                  {ocr.labelKind === "cleaning" || ocr.labelKind === "cosmetic"
                    ? " (Beauty / Products, non alimentare)"
                    : " (GS1/dogana solo con EAN)"}
                  .
                </p>
              )}
            </Card>
          )}

          {result?.evidence.productVision && (
            <Card title="Riconoscimento visivo">
              <dl className="grid gap-2 text-sm">
                {result.evidence.productVision.productName && (
                  <Meta label="Nome stimato" value={result.evidence.productVision.productName} />
                )}
                {result.evidence.productVision.brand && (
                  <Meta label="Marca stimata" value={result.evidence.productVision.brand} />
                )}
                {result.evidence.productVision.category && (
                  <Meta label="Categoria" value={result.evidence.productVision.category} />
                )}
              </dl>
              <p className="mt-2 text-sm text-slate-300">{result.evidence.productVision.description}</p>
              {result.evidence.productVision.visualCues.length > 0 && (
                <ul className="mt-2 list-inside list-disc text-xs text-slate-400">
                  {result.evidence.productVision.visualCues.map((cue) => (
                    <li key={cue}>{cue}</li>
                  ))}
                </ul>
              )}
            </Card>
          )}

          {error && (
            <div className="rounded-xl border border-rose-500/40 bg-rose-500/10 px-4 py-3 text-sm text-rose-300">
              {error}
            </div>
          )}
        </div>

        <div>
          {result ? (
            <ResultsPanel evidence={result.evidence} analysis={result.analysis} />
          ) : (
            <Card title="Risultati">
              <p className="text-sm text-slate-500">
                Aggiungi una o più foto del prodotto, poi premi{" "}
                <strong className="text-slate-400">Analizza completo</strong> per unire OCR, vision,
                banche dati e sintesi AI.
              </p>
            </Card>
          )}
        </div>
      </div>
    </div>
  );
}

function Btn({
  children,
  onClick,
  disabled,
  variant = "primary",
  className = "",
}: {
  children: ReactNode;
  onClick: () => void;
  disabled?: boolean;
  variant?: "primary" | "secondary";
  className?: string;
}) {
  const base =
    "rounded-lg px-4 py-2 text-sm font-medium transition disabled:cursor-not-allowed disabled:opacity-40";
  const styles =
    variant === "primary"
      ? "bg-emerald-600 text-white hover:bg-emerald-500"
      : "border border-slate-600 text-slate-300 hover:border-slate-500";
  return (
    <button
      type="button"
      className={`${base} ${styles} ${className}`}
      onClick={onClick}
      disabled={disabled}
    >
      {children}
    </button>
  );
}

function Badge({ ok, label }: { ok: boolean; label: string }) {
  return (
    <span
      className={`rounded-full px-2 py-0.5 ${ok ? "bg-emerald-500/20 text-emerald-400" : "bg-slate-800 text-slate-500"}`}
    >
      {ok ? "●" : "○"} {label}
    </span>
  );
}

function Meta({ label, value, mono }: { label: string; value: string; mono?: boolean }) {
  return (
    <div>
      <dt className="text-xs text-slate-500">{label}</dt>
      <dd className={`text-slate-200 ${mono ? "font-mono" : ""}`}>{value}</dd>
    </div>
  );
}
