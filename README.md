# OrigineScan

Webapp per analizzare prodotti: **OCR da foto etichetta**, interrogazione **banche dati** e **sintesi AI** sulla trasparenza filiera.

## Avvio

```bash
npm install
npm run dev
```

- Web: http://localhost:5173
- API: http://localhost:3001

## Configurazione (.env)

```env
# AI locale (consigliato)
AI_PROVIDER=ollama
OLLAMA_BASE_URL=http://localhost:11434
OLLAMA_MODEL=llama3.2:latest
OLLAMA_OCR_MODEL=glm-ocr:latest

# Opzionali
SERP_API_KEY=
UN_COMTRADE_API_KEY=
OPENAI_API_KEY=
```

Modelli Ollama suggeriti:
```bash
ollama pull llama3.2:latest
ollama pull glm-ocr:latest
```

## Flusso

1. **Foto etichetta** → OCR (Ollama vision) estrae testo, barcode, ingredienti
2. **Barcode** → Open Facts, GS1, certificazioni, dogana
3. **ProductEvidence** → struttura unificata
4. **AI** → sintesi trasparenza, fatti verificati vs claim incerti

## Test connettori

```bash
npm test
```

## Architettura

```
server/
  core/evidenceBuilder.ts   # Aggrega OCR + DB
  lib/ocrVision.ts          # OCR Ollama
  lib/llm.ts                # Analisi AI
  connectors/               # OFF, OBF, OPF, GS1…
src/
  pages/ScanPage.tsx        # UI scan + risultati
```
