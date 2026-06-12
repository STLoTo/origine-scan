import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import {
  analyzeBarcode,
  analyzeFromOcr,
  analyzeImage,
  fetchDatabasesStatus,
  fetchHealth,
  lampsForAnalyzeStep,
  MAX_PRODUCT_PHOTOS,
  mergeLampsFromEvidence,
  ocrLabel,
} from "../api/client";
import { resizeImageForOcr } from "../lib/resizeImage";
import type { AnalyzeResponse, DatabaseLamp, HealthResponse, OcrExtraction } from "../types/evidence";
import { Card } from "../components/Card";
import { DatabaseInfoPanel } from "../components/DatabaseInfoPanel";
import { DatabaseStatusGrid } from "../components/DatabaseStatusGrid";
import { ResultsPanel } from "../components/ResultsPanel";
import { DATABASE_INTRO_SHORT } from "../lib/databaseInfo";

type Step = "idle" | "ocr" | "analyze" | "done" | "error";

interface ProductPhoto {
  id: string;
  file: File;
  preview: string;
}

export function ScanPage() {
  const labelCameraRef = useRef<HTMLInputElement>(null);
  const labelGalleryRef = useRef<HTMLInputElement>(null);
  const productCameraRef = useRef<HTMLInputElement>(null);
  const productGalleryRef = useRef<HTMLInputElement>(null);

  const [preview, setPreview] = useState<string | null>(null);
  const [file, setFile] = useState<File | null>(null);
  const [productPhotos, setProductPhotos] = useState<ProductPhoto[]>([]);
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

  useEffect(() => {
    return () => {
      productPhotos.forEach((p) => URL.revokeObjectURL(p.preview));
    };
  }, [productPhotos]);

  const onLabelFile = useCallback(async (f: File) => {
    const optimized = await resizeImageForOcr(f);
    setFile(optimized);
    setPreview(URL.createObjectURL(optimized));
    setOcr(null);
    setResult(null);
    setError(null);
    setStep("idle");
  }, []);

  const addProductPhotos = useCallback(async (files: FileList | File[]) => {
    const list = Array.from(files).filter((f) => f.type.startsWith("image/"));
    if (!list.length) return;

    setProductPhotos((prev) => {
      const slots = MAX_PRODUCT_PHOTOS - prev.length;
      if (slots <= 0) return prev;

      const toAdd = list.slice(0, slots);
      const next = [
        ...prev,
        ...toAdd.map((f) => ({
          id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
          file: f,
          preview: URL.createObjectURL(f),
        })),
      ];
      return next;
    });
    setResult(null);
    setError(null);
    setStep("idle");
  }, []);

  const removeProductPhoto = useCallback((id: string) => {
    setProductPhotos((prev) => {
      const removed = prev.find((p) => p.id === id);
      if (removed) URL.revokeObjectURL(removed.preview);
      return prev.filter((p) => p.id !== id);
    });
  }, []);

  const canAnalyze = Boolean(file || barcode.trim() || ocr || productPhotos.length);

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
      const productFiles = await Promise.all(productPhotos.map((p) => resizeImageForOcr(p.file)));

      if (file || productFiles.length) {
        response = await analyzeImage(file, {
          barcode: barcode.trim() || ocr?.barcode,
          productName: ocr?.productName,
          brand: ocr?.brand,
          productImages: productFiles,
        });
        setOcr(response.evidence.ocr ?? null);
        if (response.evidence.barcode) setBarcode(response.evidence.barcode);
      } else if (ocr) {
        response = await analyzeFromOcr(ocr, barcode || undefined);
      } else if (barcode.trim()) {
        response = await analyzeBarcode(barcode.trim());
      } else {
        throw new Error("Carica un'immagine, scatta foto prodotto o inserisci un barcode");
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
  const productSlotsLeft = MAX_PRODUCT_PHOTOS - productPhotos.length;

  return (
    <div className="mx-auto min-h-screen max-w-5xl px-4 py-6">
      <header className="mb-8">
        <h1 className="text-2xl font-bold tracking-tight text-white">OrigineScan</h1>
        <p className="mt-1 text-sm text-slate-400">
          OCR etichetta · foto prodotto · banche dati · analisi AI trasparenza filiera
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
        <DatabaseStatusGrid lamps={dbLamps} />
        <DatabaseInfoPanel />
      </Card>

      <div className="grid gap-6 lg:grid-cols-2">
        <div className="space-y-4">
          <Card title="Immagine etichetta">
            <input
              ref={labelCameraRef}
              type="file"
              accept="image/*"
              capture="environment"
              className="hidden"
              onChange={(e) => {
                const f = e.target.files?.[0];
                if (f) void onLabelFile(f);
                e.target.value = "";
              }}
            />
            <input
              ref={labelGalleryRef}
              type="file"
              accept="image/*"
              className="hidden"
              onChange={(e) => {
                const f = e.target.files?.[0];
                if (f) void onLabelFile(f);
                e.target.value = "";
              }}
            />

            <button
              type="button"
              onClick={() => labelGalleryRef.current?.click()}
              className="flex min-h-[160px] w-full flex-col items-center justify-center rounded-xl border-2 border-dashed border-slate-700 bg-slate-900/50 transition hover:border-emerald-500/50 hover:bg-slate-900"
            >
              {preview ? (
                <img
                  src={preview}
                  alt="Anteprima etichetta"
                  className="max-h-56 rounded-lg object-contain"
                />
              ) : (
                <>
                  <span className="text-4xl">🏷️</span>
                  <span className="mt-2 text-sm text-slate-400">
                    Tocca per caricare l&apos;etichetta
                  </span>
                </>
              )}
            </button>

            <div className="mt-3 flex flex-wrap gap-2">
              <Btn
                onClick={() => labelCameraRef.current?.click()}
                disabled={busy}
                variant="secondary"
                className="flex-1 sm:flex-none"
              >
                📷 Scatta etichetta
              </Btn>
              <Btn
                onClick={() => labelGalleryRef.current?.click()}
                disabled={busy}
                variant="secondary"
                className="flex-1 sm:flex-none"
              >
                Carica foto
              </Btn>
            </div>

            <div className="mt-4 flex flex-wrap gap-2">
              <Btn onClick={handleOcrOnly} disabled={!file || busy} variant="secondary">
                {step === "ocr" ? "Estrazione testo…" : "Solo OCR"}
              </Btn>
              <Btn onClick={handleFullAnalyze} disabled={busy || !canAnalyze}>
                {step === "analyze" ? "Analisi in corso…" : "Analizza completo"}
              </Btn>
            </div>
          </Card>

          <Card title="Foto prodotto">
            <p className="mb-3 text-xs text-slate-500">
              Scatta una o più foto della confezione o del prodotto per aiutare l&apos;AI a
              riconoscerlo (anche senza etichetta leggibile). Max {MAX_PRODUCT_PHOTOS} foto.
            </p>

            <input
              ref={productCameraRef}
              type="file"
              accept="image/*"
              capture="environment"
              className="hidden"
              onChange={(e) => {
                const files = e.target.files;
                if (files?.length) void addProductPhotos(files);
                e.target.value = "";
              }}
            />
            <input
              ref={productGalleryRef}
              type="file"
              accept="image/*"
              multiple
              className="hidden"
              onChange={(e) => {
                const files = e.target.files;
                if (files?.length) void addProductPhotos(files);
                e.target.value = "";
              }}
            />

            {productPhotos.length > 0 && (
              <div className="mb-3 grid grid-cols-3 gap-2 sm:grid-cols-4">
                {productPhotos.map((photo) => (
                  <div key={photo.id} className="relative aspect-square overflow-hidden rounded-lg bg-slate-900">
                    <img
                      src={photo.preview}
                      alt="Foto prodotto"
                      className="h-full w-full object-cover"
                    />
                    <button
                      type="button"
                      onClick={() => removeProductPhoto(photo.id)}
                      className="absolute right-1 top-1 flex h-6 w-6 items-center justify-center rounded-full bg-black/70 text-xs text-white"
                      aria-label="Rimuovi foto"
                    >
                      ×
                    </button>
                  </div>
                ))}
              </div>
            )}

            <div className="flex flex-wrap gap-2">
              <Btn
                onClick={() => productCameraRef.current?.click()}
                disabled={busy || productSlotsLeft <= 0}
                className="min-h-12 flex-1 text-base sm:flex-none"
              >
                📷 Scatta foto prodotto
              </Btn>
              <Btn
                onClick={() => productGalleryRef.current?.click()}
                disabled={busy || productSlotsLeft <= 0}
                variant="secondary"
                className="flex-1 sm:flex-none"
              >
                {productPhotos.length ? "Aggiungi altre" : "Da galleria"}
              </Btn>
            </div>

            {productSlotsLeft <= 0 && (
              <p className="mt-2 text-xs text-amber-400">
                Limite di {MAX_PRODUCT_PHOTOS} foto raggiunto. Rimuovi una foto per aggiungerne altre.
              </p>
            )}
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
                {ocr.productName && <Meta label="Nome" value={ocr.productName} />}
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

          {result?.evidence.productVision && (
            <Card title="Riconoscimento da foto prodotto">
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
                Carica l&apos;etichetta e/o scatta <strong className="text-slate-400">foto prodotto</strong>,
                poi premi <strong className="text-slate-400">Analizza completo</strong> per unire vision,
                OCR, banche dati e sintesi AI.
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
