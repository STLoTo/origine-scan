import express from "express";
import multer from "multer";
import { buildProductEvidence } from "../core/evidenceBuilder";
import { analyzeWithAi, checkInfomaniakLlmAvailable } from "../lib/llm";
import { checkInfomaniakVisionAvailable, extractTextFromImage } from "../lib/ocrVision";
import { describeProductFromImages, maxProductImages } from "../lib/productVision";
import { isInfomaniakConfigured } from "../lib/infomaniakClient";
import { checkDatabasesReachability } from "../lib/databaseHealth";
import {
  fetchProductImage,
  isAllowedProductImageUrl,
  normalizeProductImageUrl,
} from "../lib/imageProxy";
import { serverConfig } from "../config";
import type { AnalyzeResponse } from "../types/evidence";

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 12 * 1024 * 1024 },
});

const analyzeUpload = upload.fields([
  { name: "image", maxCount: 1 },
  { name: "productImages", maxCount: maxProductImages },
]);

export const apiRouter = express.Router();

apiRouter.get("/health", async (_req, res) => {
  try {
    const [ocrOk, llmOk, databases] = await Promise.all([
      checkInfomaniakVisionAvailable(),
      checkInfomaniakLlmAvailable(),
      checkDatabasesReachability(),
    ]);

    res.json({
      status: "ok",
      infomaniak: {
        configured: isInfomaniakConfigured(),
        llmModel: serverConfig.infomaniakLlmModel,
        visionModel: serverConfig.infomaniakVisionModel,
        visionFallbackModel: serverConfig.infomaniakVisionFallbackModel || undefined,
        ocrAvailable: ocrOk,
        llmAvailable: llmOk,
      },
      aiProvider: serverConfig.aiProvider,
      databases,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Errore health check";
    res.status(503).json({ status: "error", error: message });
  }
});

/** Stato raggiungibilità banche dati (ping leggero) */
apiRouter.get("/databases/status", async (_req, res) => {
  try {
    const databases = await checkDatabasesReachability();
    res.json({ databases });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Errore stato banche dati";
    res.status(503).json({ error: message });
  }
});

/** OCR da immagine etichetta */
apiRouter.post("/ocr/label", upload.single("image"), async (req, res) => {
  try {
    if (!req.file) {
      res.status(400).json({ error: "Immagine mancante (campo image)" });
      return;
    }

    const ocr = await extractTextFromImage(req.file.buffer, req.file.mimetype);
    res.json({ success: true, ocr });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Errore OCR";
    res.status(503).json({
      success: false,
      error: message,
      hint: "Verifica token/product_id e INFOMANIAK_VISION_MODEL (es. mistralai/Ministral-3-14B-Instruct-2512)",
    });
  }
});

/** Proxy immagini prodotto (Open Facts) — evita 403 hotlink nel browser */
apiRouter.get("/image/proxy", async (req, res) => {
  const rawUrl = String(req.query.url ?? "").trim();
  const url = normalizeProductImageUrl(rawUrl);

  if (!url || !isAllowedProductImageUrl(url)) {
    res.status(400).json({ error: "URL immagine non valido o non consentito" });
    return;
  }

  try {
    const result = await fetchProductImage(url);
    if (!result.ok) {
      res.status(result.status === 403 ? 404 : result.status).end();
      return;
    }

    res.setHeader("Content-Type", result.contentType);
    res.setHeader("Cache-Control", "public, max-age=86400");
    res.send(result.buffer);
  } catch {
    res.status(502).json({ error: "Impossibile recuperare l'immagine" });
  }
});

/** Pipeline completa: OCR opzionale + foto prodotto + banche dati + AI */
apiRouter.post("/analyze", analyzeUpload, async (req, res) => {
  try {
    let ocr = undefined;
    const files = req.files as { image?: Express.Multer.File[]; productImages?: Express.Multer.File[] } | undefined;
    const labelFile = files?.image?.[0];
    const productFiles = files?.productImages ?? [];

    if (labelFile) {
      ocr = await extractTextFromImage(labelFile.buffer, labelFile.mimetype);
    } else if (req.body.ocrText) {
      ocr = {
        rawText: String(req.body.ocrText),
        barcode: req.body.barcode ? String(req.body.barcode) : undefined,
        productName: req.body.productName ? String(req.body.productName) : undefined,
        brand: req.body.brand ? String(req.body.brand) : undefined,
        ingredients: req.body.ingredients ? String(req.body.ingredients) : undefined,
        originClaims: [],
        labelClaims: [],
        provider: "manual",
        model: "none",
      };
    }

    const barcode = req.body.barcode
      ? String(req.body.barcode)
      : ocr?.barcode;

    let productVision = undefined;
    if (productFiles.length) {
      productVision = await describeProductFromImages(
        productFiles.map((f) => ({ buffer: f.buffer, mimeType: f.mimetype })),
      );
    }

    const evidence = await buildProductEvidence({
      barcode,
      ocr,
      productVision,
      productName:
        req.body.productName
          ? String(req.body.productName)
          : ocr?.productName ?? productVision?.productName,
      brand:
        req.body.brand ? String(req.body.brand) : ocr?.brand ?? productVision?.brand,
    });
    const analysis = await analyzeWithAi(evidence);

    const response: AnalyzeResponse = { evidence, analysis };
    res.json(response);
  } catch (err) {
    const message = err instanceof Error ? err.message : "Errore analisi";
    res.status(500).json({ error: message });
  }
});

/** Solo barcode → evidenze + AI (senza immagine) */
apiRouter.post("/analyze/barcode", async (req, res) => {
  try {
    const barcode = String(req.body.barcode ?? "").trim();
    if (!barcode) {
      res.status(400).json({ error: "Barcode mancante" });
      return;
    }

    const evidence = await buildProductEvidence({ barcode });
    const analysis = await analyzeWithAi(evidence);
    res.json({ evidence, analysis } satisfies AnalyzeResponse);
  } catch (err) {
    const message = err instanceof Error ? err.message : "Errore analisi";
    res.status(500).json({ error: message });
  }
});
