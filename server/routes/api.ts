import express from "express";
import multer from "multer";
import { buildProductEvidence } from "../core/evidenceBuilder";
import { analyzeWithAi, checkInfomaniakLlmAvailable } from "../lib/llm";
import { checkInfomaniakVisionAvailable, extractTextFromImage } from "../lib/ocrVision";
import { isInfomaniakConfigured } from "../lib/infomaniakClient";
import { checkDatabasesReachability } from "../lib/databaseHealth";
import { serverConfig } from "../config";
import type { AnalyzeResponse } from "../types/evidence";

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 12 * 1024 * 1024 },
});

export const apiRouter = express.Router();

apiRouter.get("/health", async (_req, res) => {
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
});

/** Stato raggiungibilità banche dati (ping leggero) */
apiRouter.get("/databases/status", async (_req, res) => {
  const databases = await checkDatabasesReachability();
  res.json({ databases });
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

/** Pipeline completa: OCR opzionale + banche dati + AI */
apiRouter.post("/analyze", upload.single("image"), async (req, res) => {
  try {
    let ocr = undefined;

    if (req.file) {
      ocr = await extractTextFromImage(req.file.buffer, req.file.mimetype);
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

    const evidence = await buildProductEvidence({
      barcode,
      ocr,
      productName: req.body.productName ? String(req.body.productName) : ocr?.productName,
      brand: req.body.brand ? String(req.body.brand) : ocr?.brand,
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
