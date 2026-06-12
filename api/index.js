// server/app.ts
import "dotenv/config";
import cors from "cors";
import express2 from "express";

// server/routes/api.ts
import express from "express";
import multer from "multer";

// server/connectors/certifications.ts
var CERT_KEYWORDS = [
  "bio",
  "organic",
  "fsc",
  "gots",
  "fair-trade",
  "dop",
  "igp",
  "pdo",
  "cruelty-free",
  "vegan",
  "rainforest-alliance",
  "ecolabel",
  "eu-ecolabel",
  "dermatologically",
  "paraben",
  "biodegradable",
  "oeko-tex",
  "fair-wear",
  "made-in-italy"
];
function extractCertifications(openProduct) {
  const tags = [
    ...openProduct?.labels_tags ?? [],
    ...openProduct?.labels?.split(",") ?? []
  ].map((t) => t.toLowerCase().trim()).filter(Boolean);
  const certifications = tags.filter((tag) => CERT_KEYWORDS.some((kw) => tag.includes(kw))).map((tag) => ({
    name: tag.replace(/-/g, " ").replace(/^en:/, ""),
    issuer: "Open Facts labels",
    source: "open_facts_labels"
  }));
  return { certifications };
}

// server/config.ts
import "dotenv/config";
var serverConfig = {
  port: Number(process.env.PORT ?? 3001),
  serpApiKey: process.env.SERP_API_KEY ?? "",
  unComtradeApiKey: process.env.UN_COMTRADE_API_KEY ?? "",
  requestTimeoutMs: Number(process.env.REQUEST_TIMEOUT_MS ?? 12e3),
  userAgent: "OrigineScan/0.4 (product-evidence)",
  aiProvider: process.env.AI_PROVIDER ?? "infomaniak",
  infomaniakApiToken: process.env.INFOMANIAK_API_TOKEN ?? "",
  infomaniakProductId: process.env.INFOMANIAK_PRODUCT_ID ?? "",
  infomaniakBaseUrl: process.env.INFOMANIAK_BASE_URL ?? "https://api.infomaniak.com",
  infomaniakLlmModel: process.env.INFOMANIAK_LLM_MODEL ?? "google/gemma-4-31B-it",
  /** Ministral 14B: multimodale, leggero, supporta IT — ideale per OCR etichette */
  infomaniakVisionModel: process.env.INFOMANIAK_VISION_MODEL ?? "mistralai/Ministral-3-14B-Instruct-2512",
  infomaniakVisionFallbackModel: process.env.INFOMANIAK_VISION_FALLBACK_MODEL ?? "Qwen/Qwen3.5-122B-A10B-FP8",
  llmTimeoutMs: Number(process.env.LLM_TIMEOUT_MS ?? 9e4)
};

// server/lib/http.ts
async function fetchJson(url, init) {
  const timeoutMs = init?.timeoutMs ?? serverConfig.requestTimeoutMs;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(url, {
      ...init,
      signal: controller.signal,
      headers: {
        "User-Agent": serverConfig.userAgent,
        Accept: "application/json",
        ...init?.headers ?? {}
      }
    });
    if (!response.ok) {
      return { ok: false, status: response.status, data: null, error: `HTTP ${response.status}` };
    }
    const data = await response.json();
    return { ok: true, status: response.status, data };
  } catch (err) {
    const message = err instanceof Error ? err.message : "Errore di rete";
    return { ok: false, status: 0, data: null, error: message };
  } finally {
    clearTimeout(timer);
  }
}

// server/connectors/customs.ts
var CATEGORY_HS_MAP = {
  "olive oils": "1509.10",
  olive: "1509.10",
  cosmetics: "3304.99",
  beauty: "3304.99",
  headphones: "8518.30",
  electronics: "8517.62",
  "t-shirts": "6109.10",
  textiles: "6109.10",
  apparel: "6109.10",
  jeans: "6203.42",
  denim: "6203.42",
  footwear: "6404.11",
  sneakers: "6404.11",
  jackets: "6201.93",
  socks: "6115.95",
  hosiery: "6115.95",
  hoodies: "6110.20",
  dresses: "6204.44",
  linen: "6204.44",
  snacks: "1904.10",
  biscuits: "1905.31",
  "cocoa and hazelnuts spreads": "1806.90",
  "hazelnuts spreads": "1806.90",
  "chocolate spreads": "1806.90",
  spreads: "1806.90",
  bread: "1905.90",
  "cleaning products": "3402.20",
  "laundry detergents": "3402.20",
  "dishwashing": "3402.20",
  detergents: "3402.20",
  "household cleaners": "3402.90",
  "fabric softeners": "3809.10",
  "floor cleaners": "3402.90",
  "toilet paper": "4818.10",
  "paper products": "4818.10",
  soap: "3401.30"
};
function inferHsCode(categories) {
  if (!categories) return void 0;
  const lower = categories.toLowerCase();
  for (const [key, hs] of Object.entries(CATEGORY_HS_MAP)) {
    if (lower.includes(key)) return hs;
  }
  return void 0;
}
function inferImportCountry(openProduct) {
  for (const field of [
    openProduct?.manufacturing_places,
    openProduct?.origins,
    openProduct?.countries
  ]) {
    const trimmed = field?.trim();
    if (trimmed) return trimmed.split(",")[0]?.trim();
  }
  return void 0;
}
async function lookupCustoms(openProduct, barcode) {
  const hs_code = inferHsCode(openProduct?.categories);
  const last_import_country = inferImportCountry(openProduct);
  if (serverConfig.unComtradeApiKey && hs_code) {
    const url = `https://comtradeapi.un.org/data/v1/get/C/A/HS?reporterCode=380&period=2024&cmdCode=${hs_code.replace(".", "")}&partnerCode=0&flowCode=M&subscription-key=${serverConfig.unComtradeApiKey}`;
    const result = await fetchJson(url, { timeoutMs: 15e3 });
    if (result.ok && result.data?.data?.length) {
      return {
        hs_code,
        last_import_country,
        granularity: "country",
        trade_records: result.data.data.length,
        source: "un_comtrade",
        barcode
      };
    }
  }
  if (!hs_code && !last_import_country) {
    return { granularity: "low", note: "Nessun dato doganale inferibile" };
  }
  return {
    hs_code,
    last_import_country,
    granularity: hs_code ? "country" : "low",
    source: "inferred_from_open_facts",
    note: serverConfig.unComtradeApiKey ? "Comtrade senza risultati \u2014 usata inferenza" : "UN_COMTRADE_API_KEY assente \u2014 inferenza da categorie Open Facts"
  };
}

// server/connectors/gs1.ts
async function lookupGs1(barcode) {
  const url = `https://api.upcitemdb.com/prod/trial/lookup?upc=${encodeURIComponent(barcode)}`;
  const result = await fetchJson(url, { timeoutMs: 15e3 });
  if (!result.ok) {
    return {
      gtin: barcode,
      source: "upcitemdb_trial",
      error: result.error ?? `HTTP ${result.status}`,
      note: "UPCitemdb non raggiungibile o rate limit trial"
    };
  }
  if (!result.data?.items?.length) {
    return {
      gtin: barcode,
      source: "upcitemdb_trial",
      note: "Nessun match per questo barcode"
    };
  }
  const item = result.data.items[0];
  return {
    gtin: barcode,
    company_name: item.company ?? item.brand ?? void 0,
    product_description: item.title ?? item.description,
    verified: false,
    source: "upcitemdb_trial",
    note: "Dati barcode pubblici \u2014 non Verified by GS1 ufficiale"
  };
}

// server/connectors/serpApi.ts
async function searchShopping(query, barcode) {
  if (!serverConfig.serpApiKey) {
    return {
      shopping_results: [],
      note: "SERP_API_KEY non configurata \u2014 configurare in .env per risultati reali"
    };
  }
  const q = barcode ? `${query} ${barcode}` : query;
  const url = `https://serpapi.com/search.json?engine=google_shopping&q=${encodeURIComponent(q)}&api_key=${serverConfig.serpApiKey}&gl=it&hl=it`;
  const result = await fetchJson(url);
  if (!result.ok || !result.data) {
    return { shopping_results: [], error: result.error };
  }
  const shopping_results = (result.data.shopping_results ?? []).slice(0, 5).map((r) => ({
    title: r.title,
    seller: r.source,
    price: r.price,
    link: r.link,
    origin_note: extractOriginFromTitle(r.title)
  }));
  return { shopping_results, source: "serpapi" };
}
function extractOriginFromTitle(title) {
  if (!title) return void 0;
  const match = title.match(/made in\s+([a-zA-Z\s]+)/i);
  return match ? match[1].trim() : void 0;
}

// server/lib/openFactsClient.ts
var OFF_FIELDS = [
  "product_name",
  "brands",
  "categories",
  "countries",
  "origins",
  "manufacturing_places",
  "ingredients_text",
  "labels",
  "labels_tags",
  "codes_tags",
  "image_url",
  "image_front_url",
  "emb_codes",
  "purchase_places"
].join(",");
function flattenProduct(product, sourceDatabase, productType) {
  return {
    product_name: String(product.product_name ?? product.product_name_it ?? ""),
    brands: String(product.brands ?? ""),
    categories: String(product.categories ?? ""),
    countries: String(product.countries ?? ""),
    origins: String(product.origins ?? ""),
    manufacturing_places: String(product.manufacturing_places ?? ""),
    ingredients_text: String(product.ingredients_text ?? ""),
    labels: String(product.labels ?? ""),
    labels_tags: Array.isArray(product.labels_tags) ? product.labels_tags : void 0,
    image_url: String(product.image_front_url ?? product.image_url ?? ""),
    product_type: productType,
    source_database: sourceDatabase
  };
}
async function fetchFromBase(baseUrl2, databaseLabel, barcode) {
  const url = `${baseUrl2}/api/v2/product/${barcode}.json?fields=${OFF_FIELDS}`;
  const result = await fetchJson(url);
  if (!result.ok || !result.data || result.data.status !== 1 || !result.data.product) {
    return null;
  }
  return flattenProduct(result.data.product, databaseLabel, result.data.product_type);
}
async function fetchUniversalProduct(barcode) {
  const universalUrl = `https://world.openfoodfacts.org/api/v2/product/${barcode}.json?fields=${OFF_FIELDS}&product_type=all`;
  const universal = await fetchJson(universalUrl);
  if (universal.ok && universal.data?.status === 1 && universal.data.product) {
    const db = universal.data.product_type === "beauty" ? "open_beauty_facts" : universal.data.product_type === "product" ? "open_products_facts" : "open_food_facts";
    return flattenProduct(universal.data.product, db, universal.data.product_type);
  }
  const order = [
    { base: "https://world.openfoodfacts.org", label: "open_food_facts" },
    { base: "https://world.openbeautyfacts.org", label: "open_beauty_facts" },
    { base: "https://world.openproductsfacts.org", label: "open_products_facts" }
  ];
  for (const source2 of order) {
    const product = await fetchFromBase(source2.base, source2.label, barcode);
    if (product?.product_name || product?.brands) return product;
  }
  return null;
}
async function fetchOpenFoodFacts(barcode) {
  return fetchFromBase("https://world.openfoodfacts.org", "open_food_facts", barcode);
}
async function searchProductByName(name, brand) {
  const query = [brand, name].filter(Boolean).join(" ").trim();
  if (query.length < 2) return null;
  const bases = [
    { base: "https://world.openfoodfacts.org", label: "open_food_facts" },
    { base: "https://world.openbeautyfacts.org", label: "open_beauty_facts" },
    { base: "https://world.openproductsfacts.org", label: "open_products_facts" }
  ];
  for (const source2 of bases) {
    const url = `${source2.base}/cgi/search.pl?search_terms=${encodeURIComponent(query)}&search_simple=1&action=process&json=1&page_size=1`;
    const result = await fetchJson(url);
    const hit = result.data?.products?.[0];
    if (!hit?.code) continue;
    const full = await fetchFromBase(source2.base, source2.label, hit.code);
    if (full?.product_name || full?.brands) {
      return { product: full, barcode: hit.code };
    }
  }
  return null;
}

// server/lib/ocrHints.ts
function extractBarcode(text) {
  const ean = text.match(/\b(\d{13})\b/);
  if (ean) return ean[1];
  const other = text.match(/\b(\d{8}|\d{12,14})\b/g);
  return other?.[other.length - 1];
}
function cleanLine(line) {
  return line.replace(/\s+/g, " ").trim();
}
function inferHintsFromRawText(rawText) {
  const lines = rawText.split("\n").map(cleanLine).filter((l) => l.length > 1);
  const barcode = extractBarcode(rawText);
  let brand;
  const brandLine = lines.find(
    (l) => /^(marca|brand|fabbricante)\s*:?\s*/i.test(l)
  );
  if (brandLine) {
    brand = brandLine.replace(/^(marca|brand|fabbricante)\s*:?\s*/i, "").trim();
  }
  const skipPattern = /^(ingredienti|ingredients|allergeni|netto|peso|e\s*an|lotto|scadenza|barcode|codice)/i;
  let productName;
  for (const line of lines.slice(0, 8)) {
    if (skipPattern.test(line)) continue;
    if (/^\d+$/.test(line)) continue;
    if (line.length < 2 || line.length > 80) continue;
    productName = line;
    break;
  }
  if (!brand && lines[0] && lines[0].length <= 25 && !skipPattern.test(lines[0])) {
    brand = lines[0];
    if (lines[1] && !skipPattern.test(lines[1]) && !productName) {
      productName = lines[1];
    }
  }
  const idx = lines.findIndex((l) => /^ingredienti/i.test(l));
  if (!productName && idx > 0) productName = lines[idx - 1];
  return { barcode, productName, brand };
}

// server/core/evidenceBuilder.ts
function splitList(value) {
  if (!value?.trim()) return [];
  return value.split(",").map((s) => s.trim()).filter(Boolean);
}
function source(id, label, status, data, ms) {
  return { source: id, label, status, data, ms };
}
async function timed(fn) {
  const start = performance.now();
  const result = await fn();
  return { result, ms: Math.round(performance.now() - start) };
}
function gs1Status(data) {
  if (data.error) return "error";
  if (data.company_name || data.product_description) return "ok";
  return "empty";
}
async function appendGs1(sources, barcode) {
  const { result: gs1, ms: gs1Ms } = await timed(() => lookupGs1(barcode));
  sources.push(source("gs1", "GS1 / Barcode lookup", gs1Status(gs1), gs1, gs1Ms));
  return gs1;
}
async function appendSerpApi(sources, query, barcode) {
  if (!serverConfig.serpApiKey) {
    sources.push(
      source("serp_api", "SerpApi Shopping", "not_configured", {
        note: "Aggiungi SERP_API_KEY in .env (serpapi.com)"
      })
    );
    return void 0;
  }
  if (!query.trim() && !barcode) {
    sources.push(
      source("serp_api", "SerpApi Shopping", "skipped", {
        note: "Serve nome prodotto o barcode"
      })
    );
    return void 0;
  }
  const { result: serp, ms } = await timed(() => searchShopping(query, barcode));
  const items = serp.shopping_results;
  sources.push(
    source(
      "serp_api",
      "SerpApi Shopping",
      serp.error ? "error" : items?.length ? "ok" : "empty",
      serp,
      ms
    )
  );
  return serp;
}
async function buildProductEvidence(input) {
  const sources = [];
  let offProduct = null;
  const ocrHints = input.ocr?.rawText ? inferHintsFromRawText(input.ocr.rawText) : {};
  let barcode = input.barcode?.trim() || input.ocr?.barcode || ocrHints.barcode;
  let searchMethod = "none";
  let searchQuery;
  const nameQuery = input.productName?.trim() || input.ocr?.productName?.trim() || input.productVision?.productName?.trim() || ocrHints.productName?.trim() || void 0;
  const brandQuery = input.brand?.trim() || input.ocr?.brand?.trim() || input.productVision?.brand?.trim() || ocrHints.brand?.trim();
  if (!barcode && nameQuery) {
    searchQuery = brandQuery ? `${brandQuery} ${nameQuery}` : nameQuery;
    const { result: nameHit, ms } = await timed(
      () => searchProductByName(nameQuery, brandQuery)
    );
    if (nameHit) {
      barcode = nameHit.barcode;
      offProduct = nameHit.product;
      searchMethod = "name";
      sources.push(
        source(
          "open_facts_search",
          "Open Facts (ricerca nome)",
          "ok",
          {
            query: searchQuery,
            matched: nameHit.product.product_name,
            barcode: nameHit.barcode,
            database: nameHit.product.source_database
          },
          ms
        )
      );
    } else {
      sources.push(
        source(
          "open_facts_search",
          "Open Facts (ricerca nome)",
          "empty",
          { query: searchQuery },
          ms
        )
      );
    }
  }
  if (barcode) {
    if (!offProduct) {
      searchMethod = searchMethod === "name" ? "name" : "barcode";
      const { result, ms } = await timed(() => fetchUniversalProduct(barcode));
      offProduct = result;
      if (result?.product_name || result?.brands) {
        sources.push(
          source(
            result.source_database,
            result.source_database.replace(/_/g, " "),
            "ok",
            result,
            ms
          )
        );
      } else {
        sources.push(
          source("open_facts", "Open Facts (universale)", "empty", {}, ms)
        );
      }
    } else {
      sources.push(
        source(
          offProduct.source_database,
          offProduct.source_database.replace(/_/g, " "),
          "ok",
          offProduct
        )
      );
    }
    const gs1 = await appendGs1(sources, barcode);
    const certs = extractCertifications(offProduct);
    const certList2 = certs.certifications;
    sources.push(
      source(
        "certifications_db",
        "Certificazioni",
        certList2.length ? "ok" : "empty",
        certs
      )
    );
    const { result: customs, ms: customsMs } = await timed(
      () => lookupCustoms(offProduct, barcode)
    );
    sources.push(
      source(
        "customs_un_comtrade",
        "Dogana / Comtrade",
        customs.hs_code || customs.last_import_country ? "ok" : "empty",
        customs,
        customsMs
      )
    );
  } else if ((input.ocr || nameQuery) && !barcode) {
    searchMethod = "ocr_only";
    const nameSearchDone = sources.some((s) => s.source === "open_facts_search");
    if (!nameSearchDone) {
      sources.push(
        source("open_facts", "Open Facts", nameQuery ? "empty" : "skipped", {
          note: nameQuery ? `Nessun match per \xAB${searchQuery ?? nameQuery}\xBB` : "Serve barcode o nome prodotto nel testo OCR"
        })
      );
    }
    sources.push(
      source("gs1", "GS1 / Barcode lookup", "skipped", {
        note: "Richiede barcode EAN"
      })
    );
    sources.push(
      source("certifications_db", "Certificazioni", "skipped", {
        note: "Richiede prodotto trovato su Open Facts"
      })
    );
    sources.push(
      source("customs_un_comtrade", "Dogana / Comtrade", "skipped", {
        note: "Richiede prodotto trovato su Open Facts"
      })
    );
  }
  const productLabel = offProduct?.product_name ?? nameQuery ?? input.ocr?.productName ?? "";
  const serpQuery = brandQuery ? `${brandQuery} ${productLabel}`.trim() : productLabel;
  const serp = await appendSerpApi(sources, serpQuery, barcode);
  if (input.ocr) {
    sources.push(
      source("ocr_label", "OCR etichetta", "ok", {
        rawText: input.ocr.rawText,
        barcode: input.ocr.barcode,
        productName: input.ocr.productName,
        brand: input.ocr.brand
      })
    );
  }
  if (input.productVision) {
    sources.push(
      source("product_vision", "Foto prodotto (vision)", "ok", {
        productName: input.productVision.productName,
        brand: input.productVision.brand,
        category: input.productVision.category,
        description: input.productVision.description,
        visualCues: input.productVision.visualCues
      })
    );
  }
  const gs1Data = sources.find((s) => s.source === "gs1" && s.status === "ok")?.data;
  const serpData = sources.find((s) => s.source === "serp_api" && s.status === "ok")?.data;
  const customsData = sources.find((s) => s.source === "customs_un_comtrade" && s.status === "ok")?.data;
  const certData = sources.find((s) => s.source === "certifications_db")?.data;
  const certList = certData?.certifications ?? [];
  const ocrCerts = (input.ocr?.labelClaims ?? []).map((name) => ({
    name,
    issuer: "OCR etichetta",
    source: "ocr_label"
  }));
  return {
    id: barcode ?? `ocr-${Date.now()}`,
    barcode,
    searchMethod,
    searchQuery,
    identity: {
      name: offProduct?.product_name ?? input.ocr?.productName ?? input.productVision?.productName ?? gs1Data?.product_description,
      brand: offProduct?.brands ?? input.ocr?.brand ?? input.productVision?.brand ?? gs1Data?.company_name,
      category: offProduct?.categories ?? input.productVision?.category,
      imageUrl: offProduct?.image_url
    },
    composition: {
      ingredients: offProduct?.ingredients_text ?? input.ocr?.ingredients
    },
    geography: {
      countries: splitList(offProduct?.countries),
      origins: [
        ...splitList(offProduct?.origins),
        ...input.ocr?.originClaims ?? []
      ],
      manufacturing: splitList(offProduct?.manufacturing_places)
    },
    certifications: [...certList, ...ocrCerts],
    customs: customsData ? {
      hsCode: customsData.hs_code,
      country: customsData.last_import_country,
      source: customsData.source
    } : void 0,
    gs1: gs1Data,
    serp,
    ocr: input.ocr,
    productVision: input.productVision,
    sources
  };
}

// server/lib/infomaniakClient.ts
function isInfomaniakConfigured() {
  return Boolean(serverConfig.infomaniakApiToken && serverConfig.infomaniakProductId);
}
function baseUrl() {
  return `${serverConfig.infomaniakBaseUrl}/2/ai/${serverConfig.infomaniakProductId}/openai/v1`;
}
async function readInfomaniakError(res) {
  try {
    const body = await res.json();
    if (typeof body.error === "string") return body.error;
    if (body.error && typeof body.error === "object" && body.error.message) {
      return body.error.message;
    }
    return body.message ?? res.statusText;
  } catch {
    return res.statusText;
  }
}
async function chatCompletion(options) {
  if (!isInfomaniakConfigured()) {
    throw new Error("Infomaniak API non configurata (INFOMANIAK_API_TOKEN, INFOMANIAK_PRODUCT_ID)");
  }
  const res = await fetch(`${baseUrl()}/chat/completions`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${serverConfig.infomaniakApiToken}`
    },
    signal: AbortSignal.timeout(serverConfig.llmTimeoutMs),
    body: JSON.stringify({
      model: options.model,
      messages: options.messages,
      stream: false,
      temperature: options.temperature ?? 0.3,
      max_completion_tokens: options.maxCompletionTokens
    })
  });
  if (!res.ok) {
    const detail = await readInfomaniakError(res);
    throw new Error(`Infomaniak HTTP ${res.status}: ${detail}`);
  }
  const data = await res.json();
  return data.choices?.[0]?.message?.content ?? "";
}
async function listModelIds() {
  if (!isInfomaniakConfigured()) return [];
  const res = await fetch(`${baseUrl()}/models`, {
    headers: { Authorization: `Bearer ${serverConfig.infomaniakApiToken}` },
    signal: AbortSignal.timeout(5e3)
  });
  if (!res.ok) return [];
  const data = await res.json();
  const items = Array.isArray(data.data) ? data.data : data.data ? [data.data] : [];
  return items.map((m) => m.id).filter(Boolean);
}
function modelAvailable(ids, model) {
  if (!model) return false;
  if (ids.includes(model)) return true;
  const base = model.split("/").pop()?.split(":")[0] ?? model;
  return ids.some((id) => id === model || id.includes(base) || id.endsWith(base));
}
async function checkInfomaniakLlmAvailable() {
  if (!isInfomaniakConfigured()) return false;
  try {
    const ids = await listModelIds();
    return modelAvailable(ids, serverConfig.infomaniakLlmModel);
  } catch {
    return false;
  }
}
async function checkInfomaniakVisionAvailable() {
  if (!isInfomaniakConfigured()) return false;
  try {
    const ids = await listModelIds();
    const primary = modelAvailable(ids, serverConfig.infomaniakVisionModel);
    const fallback = serverConfig.infomaniakVisionFallbackModel ? modelAvailable(ids, serverConfig.infomaniakVisionFallbackModel) : false;
    return primary || fallback;
  } catch {
    return false;
  }
}

// server/lib/llm.ts
var SYSTEM_PROMPT = "Sei un analista di trasparenza filiera produttiva. Rispondi in italiano. Non giudicare in base al paese. Distingui fatti verificati da claim incerti. Rispondi SOLO con JSON valido, senza markdown. verifiedFacts, uncertainClaims e conflicts devono essere array di STRINGHE, non oggetti.";
function buildUserPrompt(evidence) {
  return `Analizza queste evidenze prodotto e produci JSON:
{
  "summary": "4-6 frasi in italiano",
  "transparencyLevel": "high|medium|low",
  "verifiedFacts": ["stringa 1", "stringa 2"],
  "uncertainClaims": ["stringa 1"],
  "conflicts": ["stringa 1"]
}

Evidenze:
${JSON.stringify(evidence, null, 2)}`;
}
function normalizeStrings(value) {
  if (!Array.isArray(value)) return [];
  return value.map((item) => {
    if (typeof item === "string") return item;
    if (item && typeof item === "object") {
      const o = item;
      return String(o.fact ?? o.claim ?? o.text ?? o.description ?? o.message ?? "");
    }
    return String(item);
  }).filter(Boolean);
}
function parseAnalysis(content, provider, model) {
  const jsonMatch = content.match(/\{[\s\S]*\}/);
  if (!jsonMatch) {
    return fallbackAnalysis(content, provider, model);
  }
  try {
    const p = JSON.parse(jsonMatch[0]);
    const level = p.transparencyLevel;
    const summary = String(p.summary ?? "").trim();
    const verifiedFacts = normalizeStrings(p.verifiedFacts);
    const uncertainClaims = normalizeStrings(p.uncertainClaims);
    const conflicts = normalizeStrings(p.conflicts);
    const finalSummary = summary || (verifiedFacts.length ? verifiedFacts.slice(0, 3).join(" ") : content.replace(/\{[\s\S]*\}/, "").trim().slice(0, 600));
    return {
      available: true,
      summary: finalSummary,
      transparencyLevel: level === "high" || level === "low" ? level : "medium",
      verifiedFacts,
      uncertainClaims,
      conflicts,
      provider,
      model
    };
  } catch {
    return fallbackAnalysis(content, provider, model);
  }
}
function fallbackAnalysis(text, provider, model) {
  return {
    available: true,
    summary: text.slice(0, 800),
    transparencyLevel: "medium",
    verifiedFacts: [],
    uncertainClaims: [],
    conflicts: [],
    provider,
    model
  };
}
async function callInfomaniak(evidence) {
  const model = serverConfig.infomaniakLlmModel;
  const content = await chatCompletion({
    model,
    temperature: 0.3,
    messages: [
      { role: "system", content: SYSTEM_PROMPT },
      { role: "user", content: buildUserPrompt(evidence) }
    ]
  });
  return parseAnalysis(content, "infomaniak", model);
}
function templateAnalysis(evidence) {
  const name = evidence.identity.name ?? evidence.ocr?.productName ?? "Prodotto";
  const sources = evidence.sources.filter((s) => s.status === "ok").map((s) => s.label);
  return {
    available: false,
    summary: `${name}: raccolte evidenze da ${sources.length} fonti (${sources.join(", ") || "nessuna"}). AI non disponibile \u2014 configura Infomaniak API.`,
    transparencyLevel: sources.length >= 3 ? "medium" : "low",
    verifiedFacts: sources.length ? [`Dati presenti su: ${sources.join(", ")}`] : [],
    uncertainClaims: evidence.ocr?.originClaims ?? [],
    conflicts: [],
    reason: "LLM non configurato o non raggiungibile"
  };
}
async function analyzeWithAi(evidence) {
  if (serverConfig.aiProvider === "none") return templateAnalysis(evidence);
  if (!isInfomaniakConfigured()) return templateAnalysis(evidence);
  try {
    return await callInfomaniak(evidence);
  } catch (err) {
    const reason = err instanceof Error ? err.message : "Errore LLM";
    const base = templateAnalysis(evidence);
    return { ...base, reason };
  }
}

// server/lib/ocrVision.ts
var VISION_PROMPT = "Trascrivi fedelmente tutto il testo visibile in questa etichetta alimentare. Includi: nome prodotto, marca, ingredienti, allergeni, codice a barre/EAN, peso netto, certificazioni (bio, vegan, DOP, IGP, ecc.) e origine (prodotto in / made in). Mantieni l'ordine e le righe originali. Restituisci SOLO il testo trascritto, senza commenti n\xE9 markdown.";
function extractField(text, patterns) {
  for (const re of patterns) {
    const m = text.match(re);
    if (m?.[1]?.trim()) return m[1].trim();
  }
  return void 0;
}
function enrichFromRawText(rawText) {
  const hints = inferHintsFromRawText(rawText);
  const lower = rawText.toLowerCase();
  const ingredients = extractField(rawText, [
    /ingredienti\s*:?\s*([\s\S]{10,800}?)(?:\n\n|\n(?:allergeni|contiene|conservare|netto)|$)/i,
    /ingredients\s*:?\s*([\s\S]{10,800}?)(?:\n\n|\n(?:allergens|contains)|$)/i
  ]);
  const labelClaims = [];
  for (const kw of ["bio", "organic", "vegan", "gluten free", "senza glutine", "fair trade", "dop", "igp"]) {
    if (lower.includes(kw)) labelClaims.push(kw);
  }
  const originClaims = [];
  const originMatch = rawText.match(
    /(?:prodotto in|made in|origine|fabbricato in)\s*:?\s*([^\n,;]+)/gi
  );
  if (originMatch) originClaims.push(...originMatch.map((s) => s.trim()));
  return {
    rawText,
    productName: hints.productName,
    brand: hints.brand,
    ingredients,
    labelClaims,
    originClaims
  };
}
function cleanOcrOutput(text) {
  return text.replace(/```+[\s\S]*?```+/g, "").replace(/```+/g, "").replace(/^---+\s*$/gm, "").split("\n").filter((line, i, arr) => i === 0 || line.trim() !== arr[i - 1]?.trim()).join("\n").trim();
}
function visionMessage(base64, mimeType) {
  return [
    { type: "text", text: VISION_PROMPT },
    {
      type: "image_url",
      image_url: { url: `data:${mimeType};base64,${base64}` }
    }
  ];
}
async function runVisionOcr(model, base64, mimeType) {
  const content = await chatCompletion({
    model,
    temperature: 0.1,
    maxCompletionTokens: 2048,
    messages: [{ role: "user", content: visionMessage(base64, mimeType) }]
  });
  return cleanOcrOutput(content);
}
async function extractTextFromImage(imageBuffer, mimeType = "image/jpeg") {
  if (!isInfomaniakConfigured()) {
    throw new Error(
      "Infomaniak API non configurata. Imposta INFOMANIAK_API_TOKEN e INFOMANIAK_PRODUCT_ID nel .env"
    );
  }
  const allowed = ["image/jpeg", "image/png", "image/webp"];
  if (!allowed.includes(mimeType)) {
    throw new Error(
      `Formato ${mimeType} non supportato. Usa JPEG, PNG o WebP (no HEIC).`
    );
  }
  if (imageBuffer.length > 8 * 1024 * 1024) {
    throw new Error("Immagine troppo grande (max 8 MB). Riprova con foto pi\xF9 leggera.");
  }
  const base64 = imageBuffer.toString("base64");
  const primary = serverConfig.infomaniakVisionModel;
  const fallback = serverConfig.infomaniakVisionFallbackModel;
  let rawText = "";
  let usedModel = primary;
  try {
    rawText = await runVisionOcr(primary, base64, mimeType);
    if (!rawText.trim() && fallback && fallback !== primary) {
      rawText = await runVisionOcr(fallback, base64, mimeType);
      usedModel = fallback;
    }
  } catch (primaryErr) {
    if (!fallback || fallback === primary) throw primaryErr;
    rawText = await runVisionOcr(fallback, base64, mimeType);
    usedModel = fallback;
  }
  if (!rawText.trim()) {
    throw new Error("OCR non ha estratto testo. Prova con foto pi\xF9 nitida e ben illuminata.");
  }
  const enriched = enrichFromRawText(rawText);
  return {
    rawText: enriched.rawText ?? rawText,
    barcode: extractBarcode(rawText),
    productName: enriched.productName,
    brand: enriched.brand,
    ingredients: enriched.ingredients,
    originClaims: enriched.originClaims ?? [],
    labelClaims: enriched.labelClaims ?? [],
    provider: "infomaniak",
    model: usedModel
  };
}

// server/lib/productVision.ts
var MAX_IMAGES = 5;
var PRODUCT_VISION_PROMPT = 'Analizza queste foto di un prodotto alimentare o di consumo (confezione, fronte, retro, dettagli). Identifica tipo di prodotto, marca e nome se visibili, categoria e caratteristiche utili al riconoscimento. Rispondi SOLO con JSON valido, senza markdown:\n{"productName":"nome o null","brand":"marca o null","category":"categoria o null","description":"2-4 frasi in italiano","visualCues":["indizio visivo 1","indizio 2"]}';
function parseProductVision(content, model) {
  const jsonMatch = content.match(/\{[\s\S]*\}/);
  if (!jsonMatch) {
    return {
      description: content.trim().slice(0, 600) || "Prodotto non identificato dalle foto.",
      visualCues: [],
      provider: "infomaniak",
      model
    };
  }
  try {
    const p = JSON.parse(jsonMatch[0]);
    const str = (v) => {
      const s = String(v ?? "").trim();
      return s && s.toLowerCase() !== "null" ? s : void 0;
    };
    const visualCues = Array.isArray(p.visualCues) ? p.visualCues.map((c) => String(c).trim()).filter(Boolean) : [];
    return {
      productName: str(p.productName),
      brand: str(p.brand),
      category: str(p.category),
      description: str(p.description) ?? "Prodotto analizzato dalle foto.",
      visualCues,
      provider: "infomaniak",
      model
    };
  } catch {
    return {
      description: content.trim().slice(0, 600),
      visualCues: [],
      provider: "infomaniak",
      model
    };
  }
}
function buildVisionMessage(images) {
  const parts = [{ type: "text", text: PRODUCT_VISION_PROMPT }];
  for (const img of images) {
    parts.push({
      type: "image_url",
      image_url: { url: `data:${img.mimeType};base64,${img.base64}` }
    });
  }
  return parts;
}
async function describeProductFromImages(buffers) {
  if (!isInfomaniakConfigured()) {
    throw new Error(
      "Infomaniak API non configurata. Imposta INFOMANIAK_API_TOKEN e INFOMANIAK_PRODUCT_ID nel .env"
    );
  }
  if (!buffers.length) {
    throw new Error("Nessuna immagine prodotto fornita");
  }
  const allowed = ["image/jpeg", "image/png", "image/webp"];
  const images = buffers.slice(0, MAX_IMAGES).map(({ buffer, mimeType }) => {
    if (!allowed.includes(mimeType)) {
      throw new Error(`Formato ${mimeType} non supportato. Usa JPEG, PNG o WebP.`);
    }
    if (buffer.length > 8 * 1024 * 1024) {
      throw new Error("Immagine troppo grande (max 8 MB per foto).");
    }
    return { base64: buffer.toString("base64"), mimeType };
  });
  const primary = serverConfig.infomaniakVisionModel;
  const fallback = serverConfig.infomaniakVisionFallbackModel;
  let content = "";
  let usedModel = primary;
  try {
    content = await chatCompletion({
      model: primary,
      temperature: 0.2,
      maxCompletionTokens: 1024,
      messages: [{ role: "user", content: buildVisionMessage(images) }]
    });
    if (!content.trim() && fallback && fallback !== primary) {
      content = await chatCompletion({
        model: fallback,
        temperature: 0.2,
        maxCompletionTokens: 1024,
        messages: [{ role: "user", content: buildVisionMessage(images) }]
      });
      usedModel = fallback;
    }
  } catch (primaryErr) {
    if (!fallback || fallback === primary) throw primaryErr;
    content = await chatCompletion({
      model: fallback,
      temperature: 0.2,
      maxCompletionTokens: 1024,
      messages: [{ role: "user", content: buildVisionMessage(images) }]
    });
    usedModel = fallback;
  }
  return parseProductVision(content, usedModel);
}
var maxProductImages = MAX_IMAGES;

// server/lib/databaseCatalog.ts
var DATABASE_CATALOG = [
  {
    id: "open_food_facts",
    label: "Open Food Facts",
    short: "OFF",
    color: "#22c55e",
    searchBy: ["barcode", "name"]
  },
  {
    id: "open_beauty_facts",
    label: "Open Beauty Facts",
    short: "OBF",
    color: "#ec4899",
    searchBy: ["barcode", "name"]
  },
  {
    id: "open_products_facts",
    label: "Open Products Facts",
    short: "OPF",
    color: "#3b82f6",
    searchBy: ["barcode", "name"]
  },
  {
    id: "gs1",
    label: "GS1 / Barcode",
    short: "GS1",
    color: "#f97316",
    searchBy: ["barcode"]
  },
  {
    id: "certifications_db",
    label: "Certificazioni",
    short: "CERT",
    color: "#a855f7",
    searchBy: ["barcode"]
  },
  {
    id: "customs_un_comtrade",
    label: "Dogana",
    short: "DOG",
    color: "#64748b",
    searchBy: ["barcode"]
  },
  {
    id: "serp_api",
    label: "SerpApi Shopping",
    short: "SERP",
    color: "#eab308",
    searchBy: ["name"]
  }
];

// server/lib/databaseHealth.ts
var PROBE_BARCODE = "3017624010701";
async function timedReachable(fn) {
  const start = performance.now();
  try {
    const ok = await fn();
    return { ok, ms: Math.round(performance.now() - start) };
  } catch {
    return { ok: false, ms: Math.round(performance.now() - start) };
  }
}
async function checkDatabasesReachability() {
  const lamps = [];
  const off = await timedReachable(async () => !!await fetchOpenFoodFacts(PROBE_BARCODE));
  lamps.push({
    id: "open_food_facts",
    status: off.ok ? "online" : "offline",
    ms: off.ms,
    detail: off.ok ? "API raggiungibile" : "Non raggiungibile"
  });
  for (const id of ["open_beauty_facts", "open_products_facts"]) {
    lamps.push({
      id,
      status: off.ok ? "online" : "offline",
      ms: off.ms,
      detail: off.ok ? "Stessa piattaforma OFF" : "Non raggiungibile"
    });
  }
  const gs1 = await timedReachable(async () => {
    const r = await lookupGs1(PROBE_BARCODE);
    return !r.error && !!(r.company_name || r.product_description);
  });
  lamps.push({
    id: "gs1",
    status: gs1.ok ? "online" : "offline",
    ms: gs1.ms,
    detail: gs1.ok ? "UPCitemdb trial OK" : "UPCitemdb non raggiungibile"
  });
  lamps.push({
    id: "certifications_db",
    status: off.ok ? "online" : "offline",
    detail: "Deriva da Open Facts"
  });
  lamps.push({
    id: "customs_un_comtrade",
    status: "online",
    detail: serverConfig.unComtradeApiKey ? "Comtrade + inferenza" : "Solo inferenza"
  });
  if (serverConfig.serpApiKey) {
    const serp = await timedReachable(async () => {
      const r = await searchShopping("Nutella", PROBE_BARCODE);
      const items = r.shopping_results;
      return !r.error && (items?.length ?? 0) > 0;
    });
    lamps.push({
      id: "serp_api",
      status: serp.ok ? "online" : "offline",
      ms: serp.ms,
      detail: serp.ok ? "SerpApi connessa" : "SerpApi errore o quota"
    });
  } else {
    lamps.push({
      id: "serp_api",
      status: "not_configured",
      detail: "SERP_API_KEY assente \u2014 serpapi.com"
    });
  }
  return lamps.map((l) => {
    const meta = DATABASE_CATALOG.find((d) => d.id === l.id);
    return { ...l, detail: l.detail ?? meta?.label };
  });
}

// server/routes/api.ts
var upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 12 * 1024 * 1024 }
});
var analyzeUpload = upload.fields([
  { name: "image", maxCount: 1 },
  { name: "productImages", maxCount: maxProductImages }
]);
var apiRouter = express.Router();
apiRouter.get("/health", async (_req, res) => {
  try {
    const [ocrOk, llmOk, databases] = await Promise.all([
      checkInfomaniakVisionAvailable(),
      checkInfomaniakLlmAvailable(),
      checkDatabasesReachability()
    ]);
    res.json({
      status: "ok",
      infomaniak: {
        configured: isInfomaniakConfigured(),
        llmModel: serverConfig.infomaniakLlmModel,
        visionModel: serverConfig.infomaniakVisionModel,
        visionFallbackModel: serverConfig.infomaniakVisionFallbackModel || void 0,
        ocrAvailable: ocrOk,
        llmAvailable: llmOk
      },
      aiProvider: serverConfig.aiProvider,
      databases
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Errore health check";
    res.status(503).json({ status: "error", error: message });
  }
});
apiRouter.get("/databases/status", async (_req, res) => {
  try {
    const databases = await checkDatabasesReachability();
    res.json({ databases });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Errore stato banche dati";
    res.status(503).json({ error: message });
  }
});
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
      hint: "Verifica token/product_id e INFOMANIAK_VISION_MODEL (es. mistralai/Ministral-3-14B-Instruct-2512)"
    });
  }
});
apiRouter.post("/analyze", analyzeUpload, async (req, res) => {
  try {
    let ocr = void 0;
    const files = req.files;
    const labelFile = files?.image?.[0];
    const productFiles = files?.productImages ?? [];
    if (labelFile) {
      ocr = await extractTextFromImage(labelFile.buffer, labelFile.mimetype);
    } else if (req.body.ocrText) {
      ocr = {
        rawText: String(req.body.ocrText),
        barcode: req.body.barcode ? String(req.body.barcode) : void 0,
        productName: req.body.productName ? String(req.body.productName) : void 0,
        brand: req.body.brand ? String(req.body.brand) : void 0,
        ingredients: req.body.ingredients ? String(req.body.ingredients) : void 0,
        originClaims: [],
        labelClaims: [],
        provider: "manual",
        model: "none"
      };
    }
    const barcode = req.body.barcode ? String(req.body.barcode) : ocr?.barcode;
    let productVision = void 0;
    if (productFiles.length) {
      productVision = await describeProductFromImages(
        productFiles.map((f) => ({ buffer: f.buffer, mimeType: f.mimetype }))
      );
    }
    const evidence = await buildProductEvidence({
      barcode,
      ocr,
      productVision,
      productName: req.body.productName ? String(req.body.productName) : ocr?.productName ?? productVision?.productName,
      brand: req.body.brand ? String(req.body.brand) : ocr?.brand ?? productVision?.brand
    });
    const analysis = await analyzeWithAi(evidence);
    const response = { evidence, analysis };
    res.json(response);
  } catch (err) {
    const message = err instanceof Error ? err.message : "Errore analisi";
    res.status(500).json({ error: message });
  }
});
apiRouter.post("/analyze/barcode", async (req, res) => {
  try {
    const barcode = String(req.body.barcode ?? "").trim();
    if (!barcode) {
      res.status(400).json({ error: "Barcode mancante" });
      return;
    }
    const evidence = await buildProductEvidence({ barcode });
    const analysis = await analyzeWithAi(evidence);
    res.json({ evidence, analysis });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Errore analisi";
    res.status(500).json({ error: message });
  }
});

// server/app.ts
var app = express2();
app.use(cors());
app.use(express2.json({ limit: "2mb" }));
app.use("/api", apiRouter);
var app_default = app;
export {
  app_default as default
};
export const config = { maxDuration: 60 };
