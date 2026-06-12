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
# AI Infomaniak (API OpenAI-compatible)
AI_PROVIDER=infomaniak
INFOMANIAK_API_TOKEN=your-api-token
INFOMANIAK_PRODUCT_ID=12345
INFOMANIAK_LLM_MODEL=google/gemma-4-31B-it
INFOMANIAK_VISION_MODEL=mistralai/Ministral-3-14B-Instruct-2512
INFOMANIAK_VISION_FALLBACK_MODEL=Qwen/Qwen3.5-122B-A10B-FP8

# Opzionali
SERP_API_KEY=
UN_COMTRADE_API_KEY=
```

### Setup Infomaniak

1. Crea un token API dal [Manager Infomaniak](https://manager.infomaniak.com/)
2. Recupera il `product_id` con `GET https://api.infomaniak.com/1/ai`
3. Elenca i modelli disponibili con `GET /2/ai/{product_id}/openai/v1/models`
4. Imposta `INFOMANIAK_LLM_MODEL` (testo) e `INFOMANIAK_VISION_MODEL` (OCR via modello vision multimodale; default Ministral 14B)

Documentazione: https://developer.infomaniak.com/docs/api

## Flusso

1. **Foto etichetta** → OCR (Infomaniak vision) estrae testo, barcode, ingredienti
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
  lib/infomaniakClient.ts   # Client API Infomaniak
  lib/ocrVision.ts          # OCR vision
  lib/llm.ts                # Analisi AI
  connectors/               # OFF, OBF, OPF, GS1…
src/
  pages/ScanPage.tsx        # UI scan + risultati
```
