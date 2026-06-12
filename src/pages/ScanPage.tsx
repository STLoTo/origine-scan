import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import { analyzeBarcode, analyzeFromOcr, analyzeImage, fetchDatabasesStatus, fetchHealth, lampsForAnalyzeStep, mergeLampsFromEvidence, ocrLabel } from "../api/client";
import { resizeImageForOcr } from "../lib/resizeImage";
import type { AnalyzeResponse, DatabaseLamp, HealthResponse, OcrExtraction } from "../types/evidence";
import { Card } from "../components/Card";
import { DatabaseStatusGrid } from "../components/DatabaseStatusGrid";
import { ResultsPanel } from "../components/ResultsPanel";

type Step = "idle" | "ocr" | "analyze" | "done" | "error";

export function ScanPage() {
  const fileRef = useRef<HTMLInputElement>(null);
  const [preview, setPreview] = useState<string | null>(null);
  const [file, setFile] = useState<File | null>(null);
  const [barcode, setBarcode] = useState("");
  const [ocr, setOcr] = useState<OcrExtraction | null>(null);
  const [result, setResult] = useState<AnalyzeResponse | null>(null);
  const [step, setStep] = useState<Step>("idle");
  const [error, setError] = useState<string | null>(null);
  const [health, setHealth] = useState<HealthResponse | null>(null);
  const [dbLamps, setDbLamps] = useState<DatabaseLamp[]>([]);

  useEffect(() => {
    fetchHealth()
      .then((h) => {
        setHealth(h);
        if (h.databases?.length) setDbLamps(h.databases);
      })
      .catch(() => setHealth(null));
    fetchDatabasesStatus()
      .then(setDbLamps)
      .catch(() => undefined);
  }, []);

  const onFile = useCallback(async (f: File) => {
    const optimized = await resizeImageForOcr(f);
    setFile(optimized);
    setPreview(URL.createObjectURL(optimized));
    setOcr(null);
    setResult(null);
    setError(null);
    setStep("idle");
  }, []);

  async function handleOcrOnly() {
    if (!file) return;
    setStep("ocr");
    setError(null);
    try {
      const extracted = await ocrLabel(file);
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

      if (file) {
        response = await analyzeImage(file);
        setOcr(response.evidence.ocr ?? null);
        if (response.evidence.barcode) setBarcode(response.evidence.barcode);
      } else if (ocr) {
        response = await analyzeFromOcr(ocr, barcode || undefined);
      } else if (barcode.trim()) {
        response = await analyzeBarcode(barcode.trim());
      } else {
        throw new Error("Carica un'immagine o inserisci un barcode");
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
          OCR etichetta · banche dati · analisi AI trasparenza filiera
        </p>
        {health && (
          <div className="mt-3 flex flex-wrap gap-2 text-xs">
            <Badge ok={health.ollama.ocrAvailable} label={`OCR ${health.ollama.ocrModel}`} />
            <Badge ok={health.ollama.llmAvailable} label={`LLM ${health.ollama.llmModel}`} />
          </div>
        )}
      </header>

      <Card title="Banche dati — stato collegamento" className="mb-6">
        <p className="mb-3 text-xs text-slate-500">
          Verde = online/dati ricevuti · Ambra = interrogata ma vuota · Grigio = saltata ·
          Trattino = non configurata. Open Facts accetta <strong className="text-slate-400">EAN e nome</strong>;
          GS1, certificazioni e dogana solo <strong className="text-slate-400">EAN</strong>.
        </p>
        <DatabaseStatusGrid lamps={dbLamps} />
      </Card>

      <div className="grid gap-6 lg:grid-cols-2">
        <div className="space-y-4">
          <Card title="Immagine etichetta">
            <input
              ref={fileRef}
              type="file"
              accept="image/*"
              capture="environment"
              className="hidden"
              onChange={(e) => {
                const f = e.target.files?.[0];
                if (f) void onFile(f);
              }}
            />

            <button
              type="button"
              onClick={() => fileRef.current?.click()}
              className="flex min-h-[200px] w-full flex-col items-center justify-center rounded-xl border-2 border-dashed border-slate-700 bg-slate-900/50 transition hover:border-emerald-500/50 hover:bg-slate-900"
            >
              {preview ? (
                <img
                  src={preview}
                  alt="Anteprima etichetta"
                  className="max-h-64 rounded-lg object-contain"
                />
              ) : (
                <>
                  <span className="text-4xl">📷</span>
                  <span className="mt-2 text-sm text-slate-400">
                    Tocca per scattare o caricare foto
                  </span>
                </>
              )}
            </button>

            <div className="mt-4 flex flex-wrap gap-2">
              <Btn
                onClick={handleOcrOnly}
                disabled={!file || busy}
                variant="secondary"
              >
                {step === "ocr" ? "Estrazione testo…" : "Solo OCR"}
              </Btn>
              <Btn onClick={handleFullAnalyze} disabled={busy || (!file && !barcode && !ocr)}>
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
                {ocr.productName && (
                  <Meta label="Nome" value={ocr.productName} />
                )}
                {ocr.brand && <Meta label="Marca" value={ocr.brand} />}
                {ocr.barcode && <Meta label="Barcode" value={ocr.barcode} mono />}
              </dl>
              <pre className="max-h-48 overflow-auto whitespace-pre-wrap rounded-lg bg-slate-950 p-3 text-xs leading-relaxed text-slate-300">
                {ocr.rawText}
              </pre>
              {ocr.ingredients && (
                <p className="mt-2 text-xs text-slate-400">
                  <span className="text-slate-500">Ingredienti: </span>
                  {ocr.ingredients}
                </p>
              )}
              {ocr.barcode ? (
                <p className="mt-2 text-xs text-emerald-400">
                  Barcode rilevato: verranno interrogati Open Facts, GS1, certificazioni e dogana.
                </p>
              ) : (
                <p className="mt-2 text-xs text-amber-400">
                  Nessun barcode — verrà tentata ricerca per <strong>nome prodotto</strong> su Open Facts
                  (GS1/dogana solo con EAN).
                </p>
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
                Carica una foto dell&apos;etichetta e premi{" "}
                <strong className="text-slate-400">Analizza completo</strong> per
                unire OCR, banche dati e sintesi AI.
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
}: {
  children: ReactNode;
  onClick: () => void;
  disabled?: boolean;
  variant?: "primary" | "secondary";
}) {
  const base =
    "rounded-lg px-4 py-2 text-sm font-medium transition disabled:cursor-not-allowed disabled:opacity-40";
  const styles =
    variant === "primary"
      ? "bg-emerald-600 text-white hover:bg-emerald-500"
      : "border border-slate-600 text-slate-300 hover:border-slate-500";
  return (
    <button type="button" className={`${base} ${styles}`} onClick={onClick} disabled={disabled}>
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
