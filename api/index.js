// server/app.ts
import "dotenv/config";
import cors from "cors";
import express2 from "express";

// server/routes/api.ts
import express from "express";
import multer from "multer";

// server/lib/originParser.ts
var PRODUCT_PATTERNS = [
  /(?:prodotto e confezionato in|prodotto in|made in|fabbricato in|produced in|manufactured in)\s*:?\s*([^\n.;]+)/gi,
  /(?:confezionato in|packed in|assemblato in)\s*:?\s*([^\n.;]+)/gi
];
var INGREDIENT_LINE_PATTERNS = [
  /(?:origine del(?:la|l'| i)?|origin of the?)\s+([^:\n]+?)\s*:\s*([^\n,;.]+)/gi,
  /([A-Za-zÀ-ÿ0-9][A-Za-zÀ-ÿ0-9\s\-']{2,35})\s+(?:proveniente da|provenienza)\s+(?:da|d[''])\s*([A-Za-zÀ-ÿ][A-Za-zÀ-ÿ\s\-']{2,40})/gi
];
function cleanPlace(value) {
  return value.replace(/\s+/g, " ").replace(/[.;]+$/, "").trim();
}
function cleanIngredient(value) {
  return value.replace(/\s+/g, " ").trim();
}
function isValidIngredientOrigin(ingredient, place) {
  if (place.length < 3 || ingredient.length < 2) return false;
  if (/^l[\s']/i.test(place)) return false;
  if (/prodotto in|made in|fabbricato|confezionato/i.test(ingredient)) return false;
  return true;
}
function pushUnique(claims, claim) {
  const key = `${claim.type}|${claim.ingredient ?? ""}|${claim.place}`.toLowerCase();
  if (claims.some((c) => `${c.type}|${c.ingredient ?? ""}|${c.place}`.toLowerCase() === key)) {
    return;
  }
  claims.push(claim);
}
function parseLine(line, claims) {
  const trimmed = line.trim();
  if (!trimmed) return;
  for (const re of PRODUCT_PATTERNS) {
    re.lastIndex = 0;
    let match;
    while ((match = re.exec(trimmed)) !== null) {
      const place = cleanPlace(match[1]);
      if (place.length < 2) continue;
      const type = /confezionat|packed|assembl/i.test(match[0]) ? "manufacturing" : "product";
      pushUnique(claims, { type, place, raw: match[0].trim() });
    }
  }
  for (const re of INGREDIENT_LINE_PATTERNS) {
    re.lastIndex = 0;
    let match;
    while ((match = re.exec(trimmed)) !== null) {
      const ingredient = cleanIngredient(match[1]);
      const place = cleanPlace(match[2]);
      if (!isValidIngredientOrigin(ingredient, place)) continue;
      pushUnique(claims, {
        type: "ingredient",
        ingredient,
        place,
        raw: match[0].trim()
      });
    }
  }
  const fromMatch = trimmed.match(
    /^([A-Za-zÀ-ÿ][A-Za-zÀ-ÿ\s\-']{2,30})\s+from\s+([A-Za-zÀ-ÿ][A-Za-zÀ-ÿ\s\-']{2,30})$/i
  );
  if (fromMatch && isValidIngredientOrigin(fromMatch[1], fromMatch[2])) {
    pushUnique(claims, {
      type: "ingredient",
      ingredient: cleanIngredient(fromMatch[1]),
      place: cleanPlace(fromMatch[2]),
      raw: fromMatch[0].trim()
    });
  }
}
function parseOriginsFromText(text) {
  const claims = [];
  if (!text?.trim()) return claims;
  for (const line of text.split("\n")) {
    parseLine(line, claims);
  }
  const inlineFrom = text.matchAll(
    /\b([A-Za-zÀ-ÿ][A-Za-zÀ-ÿ\s\-']{2,30})\s+from\s+([A-Za-zÀ-ÿ][A-Za-zÀ-ÿ\s\-']{2,30})\b/gi
  );
  for (const match of inlineFrom) {
    const ingredient = cleanIngredient(match[1]);
    const place = cleanPlace(match[2]);
    if (!isValidIngredientOrigin(ingredient, place)) continue;
    pushUnique(claims, {
      type: "ingredient",
      ingredient,
      place,
      raw: match[0].trim()
    });
  }
  return claims;
}
function expandLegacyOriginClaims(lines) {
  const claims = [];
  for (const line of lines) {
    parseLine(line, claims);
  }
  return claims;
}

// server/core/supplyChain.ts
function formatOffTag(tag) {
  const cleaned = tag.replace(/^[^:]+:\s*/, "").replace(/_/g, " ").trim();
  if (!cleaned) return tag;
  return cleaned.charAt(0).toUpperCase() + cleaned.slice(1);
}
function formatTags(tags) {
  if (!tags?.length) return [];
  return [...new Set(tags.map(formatOffTag).filter(Boolean))];
}
function splitList(value) {
  if (!value?.trim()) return [];
  return value.split(",").map((s) => s.trim()).filter(Boolean);
}
function buildSupplyChainProfile(offProduct, ocr, customs) {
  const items = [];
  const ingredientOrigins = [];
  const ingredientOriginMap = /* @__PURE__ */ new Map();
  function addIngredientOrigin(ingredient, origin, level, source2, percentEstimate) {
    const key = ingredient.toLowerCase();
    const existing = ingredientOriginMap.get(key);
    if (existing && existing.level === "verified") return;
    ingredientOriginMap.set(key, {
      ingredient,
      origin,
      level,
      source: source2,
      percentEstimate: percentEstimate ?? existing?.percentEstimate
    });
  }
  const offOrigins = splitList(offProduct?.origins);
  const offOriginTags = formatTags(offProduct?.origins_tags);
  const offManufacturing = splitList(offProduct?.manufacturing_places);
  const offManufacturingTags = formatTags(offProduct?.manufacturing_places_tags);
  const offCountries = splitList(offProduct?.countries);
  const offOriginText = offProduct?.origin?.trim();
  if (offOriginText) {
    items.push({
      label: "Origine (testo etichetta OFF)",
      value: offOriginText,
      level: "partial",
      source: "Open Facts"
    });
    for (const claim of parseOriginsFromText(offOriginText)) {
      if (claim.type === "ingredient" && claim.ingredient) {
        addIngredientOrigin(claim.ingredient, claim.place, "partial", "Open Facts (origin)");
      }
    }
  }
  if (offOrigins.length || offOriginTags.length) {
    items.push({
      label: "Origine ingredienti",
      value: [...offOrigins, ...offOriginTags].join(", "),
      level: "partial",
      source: "Open Facts"
    });
  }
  if (offManufacturing.length || offManufacturingTags.length) {
    items.push({
      label: "Luogo di produzione / confezionamento",
      value: [...offManufacturing, ...offManufacturingTags].join(", "),
      level: "partial",
      source: "Open Facts"
    });
  }
  if (offCountries.length) {
    items.push({
      label: "Paesi di vendita",
      value: offCountries.join(", "),
      level: "partial",
      source: "Open Facts"
    });
  }
  if (offProduct?.emb_codes?.trim()) {
    items.push({
      label: "Codici tracciabilit\xE0 (EMB)",
      value: offProduct.emb_codes,
      level: "verified",
      source: "Open Facts"
    });
  }
  for (const ing of offProduct?.ingredients_structured ?? []) {
    if (!ing.text) continue;
    const existing = ingredientOriginMap.get(ing.text.toLowerCase());
    ingredientOriginMap.set(ing.text.toLowerCase(), {
      ingredient: ing.text,
      origin: existing?.origin,
      level: existing?.origin ? existing.level : "unavailable",
      source: existing?.source ?? "Open Facts (ingredienti)",
      percentEstimate: ing.percentEstimate
    });
  }
  const ocrText = ocr?.rawText ?? "";
  const ocrClaims = [
    ...parseOriginsFromText(ocrText),
    ...expandLegacyOriginClaims(ocr?.originClaims ?? [])
  ];
  for (const claim of ocrClaims) {
    if (claim.type === "ingredient" && claim.ingredient) {
      addIngredientOrigin(claim.ingredient, claim.place, "verified", "OCR etichetta");
      continue;
    }
    const label = claim.type === "manufacturing" ? "Produzione / confezionamento (OCR)" : "Origine prodotto (OCR)";
    const duplicate = items.some((i) => i.label === label && i.value?.includes(claim.place));
    if (!duplicate) {
      items.push({
        label,
        value: claim.place,
        level: "verified",
        source: "OCR etichetta"
      });
    }
  }
  const hasIngredients = Boolean(offProduct?.ingredients_text?.trim()) || Boolean(ocr?.ingredients?.trim());
  items.push({
    label: "Lista ingredienti",
    value: offProduct?.ingredients_text ?? ocr?.ingredients,
    level: hasIngredients ? offProduct?.ingredients_text ? "partial" : "verified" : "unavailable",
    source: offProduct?.ingredients_text ? "Open Facts" : ocr?.ingredients ? "OCR etichetta" : void 0
  });
  if (customs?.hsCode) {
    items.push({
      label: "Codice doganale (HS)",
      value: `${customs.hsCode}${customs.country ? ` \xB7 ${customs.country}` : ""}`,
      level: customs.source === "un_comtrade" ? "partial" : "partial",
      source: customs.source === "un_comtrade" ? "UN Comtrade" : "Inferenza da categoria"
    });
  }
  ingredientOrigins.push(...ingredientOriginMap.values());
  const hasIngredientOrigins = ingredientOrigins.some((i) => i.origin);
  const hasGeo = items.some(
    (i) => i.level !== "unavailable" && !i.label.startsWith("Lista ingredienti") && !i.label.startsWith("Codice doganale")
  );
  let overallLevel = "unavailable";
  if (hasIngredientOrigins && hasGeo) overallLevel = "verified";
  else if (hasIngredientOrigins || hasGeo || hasIngredients) overallLevel = "partial";
  const summary = overallLevel === "verified" ? "Filiera parzialmente tracciabile: presenti origini specifiche e dati geografici." : overallLevel === "partial" ? "Dati filiera incompleti: ingredienti o geografia generica, origini per singolo ingrediente limitate." : "Filiera non tracciabile: mancano origini e dati geografici affidabili.";
  return { items, ingredientOrigins, overallLevel, summary };
}

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

// server/lib/imageProxy.ts
var ALLOWED_IMAGE_HOSTS = /* @__PURE__ */ new Set([
  "images.openfoodfacts.org",
  "images.openbeautyfacts.org",
  "images.openproductsfacts.org",
  "static.openfoodfacts.org",
  "static.openbeautyfacts.org",
  "static.openproductsfacts.org",
  "world.openfoodfacts.org",
  "world.openbeautyfacts.org",
  "world.openproductsfacts.org"
]);
function normalizeProductImageUrl(url) {
  if (!url?.trim()) return void 0;
  try {
    const parsed = new URL(url.trim());
    if (parsed.protocol !== "https:" && parsed.protocol !== "http:") return void 0;
    return parsed.href;
  } catch {
    return void 0;
  }
}
function isAllowedProductImageUrl(url) {
  try {
    const parsed = new URL(url);
    return ALLOWED_IMAGE_HOSTS.has(parsed.hostname);
  } catch {
    return false;
  }
}
async function fetchProductImage(url) {
  const res = await fetch(url, {
    headers: {
      "User-Agent": serverConfig.userAgent,
      Accept: "image/avif,image/webp,image/apng,image/*,*/*;q=0.8"
    },
    signal: AbortSignal.timeout(serverConfig.requestTimeoutMs),
    redirect: "follow"
  });
  if (!res.ok) {
    return { ok: false, status: res.status };
  }
  const contentType = res.headers.get("content-type") ?? "image/jpeg";
  if (!contentType.startsWith("image/")) {
    return { ok: false, status: 415 };
  }
  const buffer = Buffer.from(await res.arrayBuffer());
  return { ok: true, buffer, contentType };
}

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
function buildWebSearchQuery(brand, productName, labelKind) {
  const base = [brand, productName].filter(Boolean).join(" ").trim();
  if (!base) return "";
  if (labelKind === "cleaning" || labelKind === "cosmetic") {
    return `${base} origine produzione scheda INCI filiera`;
  }
  return `${base} origine ingredienti filiera produzione`;
}
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
async function searchWeb(query, barcode) {
  if (!serverConfig.serpApiKey) {
    return {
      query,
      organic_results: [],
      source: "serpapi",
      note: "SERP_API_KEY non configurata \u2014 configurare in .env per risultati reali"
    };
  }
  const q = barcode ? `${query} ${barcode}`.trim() : query.trim();
  if (!q) {
    return { query: q, organic_results: [], source: "serpapi", note: "Query vuota" };
  }
  const url = `https://serpapi.com/search.json?engine=google&q=${encodeURIComponent(q)}&api_key=${serverConfig.serpApiKey}&gl=it&hl=it&num=5`;
  const result = await fetchJson(url);
  if (!result.ok || !result.data) {
    return {
      query: q,
      organic_results: [],
      source: "serpapi",
      error: result.error
    };
  }
  const organic_results = (result.data.organic_results ?? []).slice(0, 5).map((r) => ({
    title: r.title,
    link: r.link,
    snippet: r.snippet,
    source: r.source
  }));
  const answer_box = result.data.answer_box?.snippet ? {
    title: result.data.answer_box.title,
    snippet: result.data.answer_box.snippet,
    link: result.data.answer_box.link
  } : void 0;
  const knowledge_graph = result.data.knowledge_graph ? {
    title: result.data.knowledge_graph.title,
    description: result.data.knowledge_graph.description,
    source: result.data.knowledge_graph.source?.name
  } : void 0;
  return {
    query: q,
    organic_results,
    answer_box,
    knowledge_graph,
    source: "serpapi"
  };
}

// server/lib/productMatch.ts
var STOP_WORDS = /* @__PURE__ */ new Set([
  "valsoia",
  "prodotto",
  "immagine",
  "scopo",
  "presentare",
  "vegetale",
  "naturale",
  "added",
  "senza",
  "sale",
  "ricco",
  "proteine",
  "bont\xE0",
  "salute",
  "marca",
  "brand"
]);
var HARD_CONFLICTS = [
  { ocr: /\btofu\b/i, db: /\b(nocciol|hazelnut|cacao|spalmab|spread|crema)\b/i },
  { ocr: /\byogurt\b/i, db: /\b(pasta|ragù|sugo)\b/i },
  { ocr: /\blatte\b/i, db: /\b(tofu|seitan)\b/i },
  {
    ocr: /agents de surface|sodium laureth|tenside|detergent|nettoyant|surface active/i,
    db: /\b(chocolate|nutella|pasta|yogurt|tofu|cheese|fromage|biscuit|snack)\b/i
  }
];
function normalizeText(text) {
  return text.toLowerCase().normalize("NFD").replace(new RegExp("\\p{M}", "gu"), "").replace(/[^\p{L}\p{N}\s]/gu, " ");
}
function tokenize(text, excludeBrand) {
  const brandNorm = excludeBrand ? normalizeText(excludeBrand) : "";
  return normalizeText(text).split(/\s+/).filter((w) => w.length >= 3).filter((w) => !STOP_WORDS.has(w)).filter((w) => !brandNorm || w !== brandNorm);
}
function scoreProductAgainstOcr(ocrText, product, brand) {
  const ocrTokens = tokenize(ocrText, brand);
  if (!ocrTokens.length) return 0.5;
  const dbText = [product.product_name, product.categories, product.ingredients_text].filter(Boolean).join(" ");
  const dbBlob = normalizeText(dbText);
  let hits = 0;
  for (const token of ocrTokens) {
    if (dbBlob.includes(token)) hits += 1;
  }
  return hits / ocrTokens.length;
}
function hasHardProductConflict(ocrText, product) {
  const dbText = [product.product_name, product.categories, product.ingredients_text].filter(Boolean).join(" ");
  return HARD_CONFLICTS.some(({ ocr, db }) => ocr.test(ocrText) && db.test(dbText));
}
function isOcrDatabaseMismatch(ocrText, product, brand, minScore = 0.2) {
  if (hasHardProductConflict(ocrText, product)) return true;
  return scoreProductAgainstOcr(ocrText, product, brand) < minScore;
}

// server/lib/openFactsClient.ts
var OFF_FIELDS = [
  "product_name",
  "brands",
  "categories",
  "countries",
  "countries_tags",
  "origins",
  "origins_tags",
  "origin",
  "manufacturing_places",
  "manufacturing_places_tags",
  "ingredients_text",
  "ingredients",
  "labels",
  "labels_tags",
  "codes_tags",
  "image_url",
  "image_front_url",
  "emb_codes",
  "purchase_places"
].join(",");
function flattenIngredients(raw) {
  if (!Array.isArray(raw)) return void 0;
  const list = raw.map((item) => {
    if (!item || typeof item !== "object") return null;
    const o = item;
    const text = String(o.text ?? "").trim();
    if (!text) return null;
    return {
      text,
      percentEstimate: typeof o.percent_estimate === "number" ? o.percent_estimate : void 0,
      percentMin: typeof o.percent_min === "number" ? o.percent_min : void 0,
      percentMax: typeof o.percent_max === "number" ? o.percent_max : void 0
    };
  }).filter(Boolean);
  return list.length ? list : void 0;
}
function flattenProduct(product, sourceDatabase, productType) {
  return {
    product_name: String(product.product_name ?? product.product_name_it ?? ""),
    brands: String(product.brands ?? ""),
    categories: String(product.categories ?? ""),
    countries: String(product.countries ?? ""),
    countries_tags: Array.isArray(product.countries_tags) ? product.countries_tags : void 0,
    origins: String(product.origins ?? ""),
    origins_tags: Array.isArray(product.origins_tags) ? product.origins_tags : void 0,
    origin: String(product.origin ?? product.origin_it ?? product.origin_fr ?? ""),
    manufacturing_places: String(product.manufacturing_places ?? ""),
    manufacturing_places_tags: Array.isArray(product.manufacturing_places_tags) ? product.manufacturing_places_tags : void 0,
    purchase_places: String(product.purchase_places ?? ""),
    emb_codes: String(product.emb_codes ?? ""),
    ingredients_text: String(product.ingredients_text ?? ""),
    ingredients_structured: flattenIngredients(product.ingredients),
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
var ALL_DATABASES = [
  { base: "https://world.openfoodfacts.org", label: "open_food_facts" },
  { base: "https://world.openbeautyfacts.org", label: "open_beauty_facts" },
  { base: "https://world.openproductsfacts.org", label: "open_products_facts" }
];
function databasesForLabelKind(labelKind) {
  if (labelKind === "cleaning") {
    return [ALL_DATABASES[2], ALL_DATABASES[1], ALL_DATABASES[0]];
  }
  if (labelKind === "cosmetic") {
    return [ALL_DATABASES[1], ALL_DATABASES[2], ALL_DATABASES[0]];
  }
  return [...ALL_DATABASES];
}
async function searchProductByName(name, brandOrOptions, legacyBrand) {
  const options = typeof brandOrOptions === "string" ? { brand: brandOrOptions ?? legacyBrand } : brandOrOptions ?? { brand: legacyBrand };
  const brand = options.brand;
  const query = [brand, name].filter(Boolean).join(" ").trim();
  if (query.length < 2) return null;
  const bases = databasesForLabelKind(options.labelKind);
  let best = null;
  for (const source2 of bases) {
    const url = `${source2.base}/cgi/search.pl?search_terms=${encodeURIComponent(query)}&search_simple=1&action=process&json=1&page_size=5`;
    const result = await fetchJson(url);
    const hits = result.data?.products ?? [];
    for (const hit of hits) {
      if (!hit?.code) continue;
      const full = await fetchFromBase(source2.base, source2.label, hit.code);
      if (!full?.product_name && !full?.brands) continue;
      const score = options.ocrText ? scoreProductAgainstOcr(options.ocrText, full, brand) : 0.5;
      if (!best || score > best.score) {
        best = { product: full, barcode: hit.code, score };
      }
    }
    if (best && best.score >= 0.2) break;
  }
  if (!best) return null;
  if (options.ocrText && best.score < 0.15) return null;
  return { product: best.product, barcode: best.barcode };
}

// server/lib/barcode.ts
var VALID_LENGTHS = /* @__PURE__ */ new Set([8, 12, 13, 14]);
function checksumDigit(payload) {
  let sum = 0;
  for (let i = 0; i < payload.length; i++) {
    const digit = parseInt(payload[payload.length - 1 - i], 10);
    sum += digit * (i % 2 === 0 ? 3 : 1);
  }
  return (10 - sum % 10) % 10;
}
function isValidEan(code) {
  const digits = code.replace(/\D/g, "");
  if (!VALID_LENGTHS.has(digits.length)) return false;
  if (!/^\d+$/.test(digits)) return false;
  const expected = checksumDigit(digits.slice(0, -1));
  return expected === parseInt(digits.at(-1), 10);
}
function sanitizeBarcode(code) {
  const trimmed = code?.trim();
  if (!trimmed) return void 0;
  const digits = trimmed.replace(/\D/g, "");
  return isValidEan(digits) ? digits : void 0;
}

// server/lib/ocrTextAnalysis.ts
var INGREDIENTS_HEADER = /^(?:ingredienti|ingredients|ingr[eé]dients|inhaltsstoffe|zutaten|composition)\s*:?\s*$/i;
var INGREDIENTS_INLINE = /(?:ingredienti|ingredients|ingr[eé]dients|inhaltsstoffe|zutaten|composition)\s*:?\s*/i;
var INGREDIENTS_STOP = /^(?:allerg[eè]nes?|allergens|allergeni|inhaltsstoffe|zutaten|conservare|conservation|netto|peso|tenir|keep out|en cas de|ne pas)\b/i;
var SAFETY_LINE = /^(?:en cas de|ne pas |tenir hors|appeler un|pr[eé]venir les|ne pas donner|n cas de|in case of|keep out|call a doctor|bei kontakt|achtung|warning|danger|attention|irritation|intoxic|vomit|m[eé]decin|antipoison|lentilles|rincer|laver à l)/i;
var CLEANING_SIGNALS = /agents de surface|tenside|sodium laureth|sodium lauryl|detergent|nettoyant|liquide vaisselle|household|cleaning|surface active|waschmittel|reinigungsmittel/i;
var COSMETIC_SIGNALS = /parfum|aqua\/water|shampoo|shower gel|body wash|cosm[eé]tique|capelli|corpo|viso|lotion|cr[eè]me douche/i;
var FOOD_SIGNALS = /(?:^|\n)ingredienti\b|allergeni|nutri(?:tion|ente)|kcal|kj\b|prodotto in|made in|fabbricato in|vegan food|aliment/i;
var HALLUCINATED_TRIDECETH = /Sodium Trideceth-(?:[4-9]\d{2,}|\d{4,})\s+Sulfate/gi;
function cleanLine(line) {
  return line.replace(/\s+/g, " ").trim();
}
function isSafetyOrInstructionLine(line) {
  const trimmed = cleanLine(line);
  if (trimmed.length < 3) return true;
  return SAFETY_LINE.test(trimmed);
}
function detectLabelKind(text) {
  if (CLEANING_SIGNALS.test(text)) return "cleaning";
  if (COSMETIC_SIGNALS.test(text)) return "cosmetic";
  if (FOOD_SIGNALS.test(text)) return "food";
  if (/inhaltsstoffe|ingr[eé]dients/i.test(text) && /parfum|aqua|tenside|surface/i.test(text)) {
    return "cleaning";
  }
  return "unknown";
}
function sanitizeHallucinatedOcr(rawText) {
  const warnings = [];
  let text = rawText;
  if (HALLUCINATED_TRIDECETH.test(rawText)) {
    warnings.push(
      "Possibile allucinazione OCR: lista tensioattivi con numeri implausibili (es. Trideceth-10000). Verifica l'etichetta originale."
    );
    text = text.replace(HALLUCINATED_TRIDECETH, "");
    text = text.replace(/,\s*,/g, ", ").replace(/\s{2,}/g, " ");
  }
  const tridecethCount = (rawText.match(/Sodium Trideceth-\d+/gi) ?? []).length;
  if (tridecethCount > 12) {
    warnings.push(
      `Lista ingredienti sospetta: ${tridecethCount} varianti \xABSodium Trideceth-*\xBB \u2014 probabile errore OCR.`
    );
  }
  return { text: text.trim(), warnings };
}
function extractIngredientsBlock(rawText) {
  const multiline = rawText.match(
    /(?:ingredienti|ingredients|ingr[eé]dients|inhaltsstoffe|zutaten|composition)\s*:?\s*\n([\s\S]{10,2000}?)(?:\n\s*\n|\n(?:allerg[eè]nes?|allergens|allergeni|inhaltsstoffe|zutaten|tenir|keep out)\b|$)/i
  );
  if (multiline?.[1]?.trim()) {
    return multiline[1].replace(/\s+/g, " ").replace(/,\s*,/g, ", ").trim().slice(0, 1500);
  }
  const lines = rawText.split("\n").map(cleanLine);
  const blocks = [];
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const inline = line.match(
      new RegExp(`${INGREDIENTS_INLINE.source}(.+)`, "i")
    );
    if (inline?.[1]?.trim()) {
      blocks.push(inline[1].trim());
      continue;
    }
    if (!INGREDIENTS_HEADER.test(line)) continue;
    const chunk = [];
    for (let j = i + 1; j < lines.length; j++) {
      const next = lines[j];
      if (!next) continue;
      if (INGREDIENTS_HEADER.test(next) || INGREDIENTS_STOP.test(next)) break;
      if (isSafetyOrInstructionLine(next)) break;
      chunk.push(next);
      if (chunk.join(" ").length > 1200) break;
    }
    if (chunk.length) blocks.push(chunk.join(" "));
  }
  if (!blocks.length) return void 0;
  const merged = blocks[0].replace(/\s+/g, " ").replace(/,\s*,/g, ", ").trim();
  return merged.length >= 10 ? merged.slice(0, 1500) : void 0;
}
function analyzeOcrText(rawText) {
  const { text: cleanedText, warnings } = sanitizeHallucinatedOcr(rawText);
  const labelKind = detectLabelKind(cleanedText);
  const ingredients = extractIngredientsBlock(cleanedText);
  if (labelKind === "cleaning" || labelKind === "cosmetic") {
    warnings.push(
      labelKind === "cleaning" ? "Etichetta detergente/igienizzante rilevata \u2014 Open Beauty Facts / Open Products Facts, non alimentare." : "Etichetta cosmetica rilevata \u2014 ricerca su Open Beauty Facts."
    );
  }
  if (!ingredients && /ingr[eé]dients|inhaltsstoffe|ingredienti/i.test(cleanedText)) {
    warnings.push("Sezione ingredienti presente ma non estratta completamente \u2014 controlla il testo grezzo.");
  }
  return { labelKind, warnings, cleanedText, ingredients };
}

// server/lib/ocrHints.ts
function extractBarcode(text) {
  const candidates = text.match(/\b(\d{8}|\d{12,14})\b/g) ?? [];
  for (let i = candidates.length - 1; i >= 0; i--) {
    const code = candidates[i];
    if (isValidEan(code)) return code;
  }
  return void 0;
}
function cleanLine2(line) {
  return line.replace(/\s+/g, " ").trim();
}
function normalizeToken(value) {
  return value.toLowerCase().normalize("NFD").replace(new RegExp("\\p{M}", "gu"), "").trim();
}
var SKIP_LINE = /^(ingredienti|ingredients|ingr[eé]dients|inhaltsstoffe|zutaten|allergeni|allerg[eè]nes|netto|peso|e\s*an|lotto|scadenza|barcode|codice|l['']immagine|prodotto in|made in|fabbricato in|composition)/i;
var CLAIM_OR_TAGLINE = /^(100%|ricco di|senza |no |privo|vegan|bio|organic|fair trade|bontà|salute|gusto|zero |free |gluten|agents de surface|tenside)/i;
var WEIGHT_LINE = /^\d+\s*[x×]\s*\d+/i;
function isClaimOrTagline(line) {
  const norm = normalizeToken(line);
  if (CLAIM_OR_TAGLINE.test(line) || CLAIM_OR_TAGLINE.test(norm)) return true;
  return /^(bonta e salute|100 vegetale)$/.test(norm);
}
function isBrandLine(line, brand) {
  if (!brand) return false;
  const lineNorm = normalizeToken(line);
  const brandNorm = normalizeToken(brand);
  return lineNorm === brandNorm || lineNorm.startsWith(`${brandNorm} `);
}
function looksLikeInciLine(line) {
  if (/^>\s*\d+%/.test(line)) return true;
  if (/^(agents de|anionische|non ioniques|amphot|eau,|water,|aqua)/i.test(line)) return true;
  if (line.includes(",") && /sulfate|chloride|parfum|limonene|betaine|glucoside|benzoate|edta/i.test(line)) {
    return true;
  }
  return false;
}
function isUsableNameLine(line) {
  if (isSafetyOrInstructionLine(line)) return false;
  if (looksLikeInciLine(line)) return false;
  if (line.length < 2 || line.length > 80) return false;
  if (/^(agents de|anionische|non ioniques|amphot)/i.test(line)) return false;
  return true;
}
function inferProductName(lines, brand) {
  const nameParts = [];
  for (const line of lines.slice(0, 20)) {
    if (SKIP_LINE.test(line)) break;
    if (!isUsableNameLine(line)) continue;
    if (/^\d+$/.test(line)) continue;
    if (WEIGHT_LINE.test(line)) continue;
    if (isBrandLine(line, brand)) continue;
    if (isClaimOrTagline(line)) continue;
    const looksLikeNamePart = /^[A-ZÀ-Ü0-9][A-ZÀ-Ü0-9\s\-']*$/.test(line) && line.length <= 28 && !line.includes(",");
    if (looksLikeNamePart) {
      nameParts.push(line);
      if (nameParts.length >= 3) break;
      continue;
    }
    if (!nameParts.length) return line;
    break;
  }
  if (nameParts.length) return nameParts.join(" ");
  return void 0;
}
function inferHintsFromRawText(rawText) {
  const lines = rawText.split("\n").map(cleanLine2).filter((l) => l.length > 1);
  const barcode = extractBarcode(rawText);
  let brand;
  const brandLine = lines.find(
    (l) => /^(marca|brand|fabbricante|marque)\s*:?\s*/i.test(l)
  );
  if (brandLine) {
    brand = brandLine.replace(/^(marca|brand|fabbricante|marque)\s*:?\s*/i, "").trim();
  }
  if (!brand && lines[0] && lines[0].length <= 25 && !SKIP_LINE.test(lines[0]) && !isSafetyOrInstructionLine(lines[0])) {
    brand = lines[0];
  }
  let productName = inferProductName(lines, brand);
  const skipPattern = /^(ingredienti|ingredients|ingr[eé]dients|inhaltsstoffe|allergeni|allerg[eè]nes|netto|peso|e\s*an|lotto|scadenza|barcode|codice)/i;
  if (!productName) {
    for (const line of lines.slice(0, 12)) {
      if (skipPattern.test(line)) break;
      if (!isUsableNameLine(line)) continue;
      if (/^\d+$/.test(line)) continue;
      if (isBrandLine(line, brand)) continue;
      productName = line;
      break;
    }
  }
  const idx = lines.findIndex((l) => /^(?:ingredienti|ingr[eé]dients|inhaltsstoffe)/i.test(l));
  if (!productName && idx > 0) {
    const candidate = lines[idx - 1];
    if (candidate && !isBrandLine(candidate, brand) && isUsableNameLine(candidate)) {
      productName = candidate;
    }
  }
  if (productName && isSafetyOrInstructionLine(productName)) productName = void 0;
  if (brand && isSafetyOrInstructionLine(brand)) brand = void 0;
  return {
    barcode: sanitizeBarcode(barcode),
    productName,
    brand
  };
}

// server/core/evidenceBuilder.ts
function splitList2(value) {
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
async function appendWebSearch(sources, query, barcode) {
  if (!serverConfig.serpApiKey) {
    sources.push(
      source("serp_web", "Ricerca web (SerpApi)", "not_configured", {
        note: "Aggiungi SERP_API_KEY in .env (serpapi.com)"
      })
    );
    return void 0;
  }
  if (!query.trim() && !barcode) {
    sources.push(
      source("serp_web", "Ricerca web (SerpApi)", "skipped", {
        note: "Serve nome prodotto o barcode"
      })
    );
    return void 0;
  }
  const { result: web, ms } = await timed(() => searchWeb(query, barcode));
  const hasResults = (web.organic_results?.length ?? 0) > 0 || Boolean(web.answer_box?.snippet) || Boolean(web.knowledge_graph?.description);
  sources.push(
    source(
      "serp_web",
      "Ricerca web (SerpApi)",
      web.error ? "error" : hasResults ? "ok" : "empty",
      web,
      ms
    )
  );
  return web;
}
async function buildProductEvidence(input) {
  const sources = [];
  let offProduct = null;
  const ocrRawText = input.ocr?.rawText;
  const ocrHints = ocrRawText ? inferHintsFromRawText(ocrRawText) : {};
  let barcode = sanitizeBarcode(
    input.barcode?.trim() || input.ocr?.barcode || ocrHints.barcode
  );
  let searchMethod = "none";
  let searchQuery;
  const nameQuery = input.productName?.trim() || input.ocr?.productName?.trim() || input.productVision?.productName?.trim() || ocrHints.productName?.trim() || void 0;
  const brandQuery = input.brand?.trim() || input.ocr?.brand?.trim() || input.productVision?.brand?.trim() || ocrHints.brand?.trim();
  function rejectDatabaseMatch(rejected, rejectedBarcode, via, query) {
    sources.push(
      source("open_facts_rejected", "Open Facts (identit\xE0 non concorde)", "empty", {
        via,
        query,
        attemptedProduct: rejected.product_name,
        attemptedBarcode: rejectedBarcode,
        note: "Il prodotto trovato in banca dati non corrisponde al testo OCR dell'etichetta. Vengono mostrati solo i dati letti dall'etichetta."
      })
    );
    offProduct = null;
    barcode = void 0;
    searchMethod = "ocr_only";
  }
  if (!barcode && nameQuery) {
    searchQuery = brandQuery ? `${brandQuery} ${nameQuery}` : nameQuery;
    const { result: nameHit, ms } = await timed(
      () => searchProductByName(nameQuery, {
        brand: brandQuery,
        ocrText: ocrRawText,
        labelKind: input.ocr?.labelKind
      })
    );
    if (nameHit) {
      if (ocrRawText && isOcrDatabaseMismatch(ocrRawText, nameHit.product, brandQuery)) {
        rejectDatabaseMatch(nameHit.product, nameHit.barcode, "name", searchQuery);
        sources.push(
          source(
            "open_facts_search",
            "Open Facts (ricerca nome)",
            "empty",
            { query: searchQuery, rejected: nameHit.product.product_name },
            ms
          )
        );
      } else {
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
      }
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
        if (ocrRawText && isOcrDatabaseMismatch(ocrRawText, result, brandQuery)) {
          rejectDatabaseMatch(result, barcode, "barcode", searchQuery);
          sources.push(
            source(
              result.source_database,
              result.source_database.replace(/_/g, " "),
              "empty",
              {
                rejected: result.product_name,
                barcode
              },
              ms
            )
          );
        } else {
          sources.push(
            source(
              result.source_database,
              result.source_database.replace(/_/g, " "),
              "ok",
              result,
              ms
            )
          );
        }
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
    if (!offProduct) {
      sources.push(
        source("gs1", "GS1 / Barcode lookup", "skipped", {
          note: "Match banca dati non coerente con OCR"
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
    } else {
      await appendGs1(sources, barcode);
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
      const { result: customs2, ms: customsMs } = await timed(
        () => lookupCustoms(offProduct, barcode)
      );
      sources.push(
        source(
          "customs_un_comtrade",
          "Dogana / Comtrade",
          customs2.hs_code || customs2.last_import_country ? "ok" : "empty",
          customs2,
          customsMs
        )
      );
    }
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
  const webQuery = buildWebSearchQuery(
    brandQuery,
    productLabel || input.ocr?.productName,
    input.ocr?.labelKind
  );
  const [serp, webSearch] = await Promise.all([
    appendSerpApi(sources, serpQuery, barcode),
    appendWebSearch(sources, webQuery || serpQuery, barcode)
  ]);
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
  const customs = customsData ? {
    hsCode: customsData.hs_code,
    country: customsData.last_import_country,
    source: customsData.source
  } : void 0;
  const supplyChain = buildSupplyChainProfile(offProduct, input.ocr, customs);
  return {
    id: barcode ?? `ocr-${Date.now()}`,
    barcode,
    searchMethod,
    searchQuery,
    identity: {
      name: offProduct?.product_name ?? input.ocr?.productName ?? input.productVision?.productName ?? gs1Data?.product_description,
      brand: offProduct?.brands ?? input.ocr?.brand ?? input.productVision?.brand ?? gs1Data?.company_name,
      category: offProduct?.categories ?? input.productVision?.category,
      imageUrl: normalizeProductImageUrl(offProduct?.image_url)
    },
    composition: {
      ingredients: offProduct?.ingredients_text ?? input.ocr?.ingredients,
      structured: offProduct?.ingredients_structured
    },
    geography: {
      countries: splitList2(offProduct?.countries),
      origins: [
        ...splitList2(offProduct?.origins),
        ...offProduct?.origin?.trim() ? [offProduct.origin.trim()] : []
      ],
      manufacturing: splitList2(offProduct?.manufacturing_places),
      purchasePlaces: splitList2(offProduct?.purchase_places),
      originTags: offProduct?.origins_tags,
      manufacturingTags: offProduct?.manufacturing_places_tags
    },
    meta: offProduct ? {
      sourceDatabase: offProduct.source_database,
      traceabilityCodes: splitList2(offProduct.emb_codes),
      labels: [
        ...splitList2(offProduct.labels),
        ...offProduct.labels_tags?.map((t) => t.replace(/^[^:]+:\s*/, "")) ?? []
      ].filter((v, i, arr) => arr.indexOf(v) === i)
    } : input.ocr?.labelClaims?.length ? { traceabilityCodes: [], labels: input.ocr.labelClaims } : void 0,
    certifications: [...certList, ...ocrCerts],
    customs,
    supplyChain,
    gs1: gs1Data,
    serp,
    webSearch,
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
var SYSTEM_PROMPT = "Sei un analista di trasparenza filiera produttiva. Rispondi in italiano. Non giudicare in base al paese. Distingui fatti verificati da claim incerti. Se sono presenti risultati di ricerca web o il profilo filiera (supplyChain), usali per affinare la sintesi (marca, categoria, origine, contesto). Il web non \xE8 fonte assoluta: confrontalo con OCR e banche dati e segnala conflitti. Per ogni origine ingrediente indica il livello di certezza (verified/partial/unavailable). Rispondi SOLO con JSON valido, senza markdown. verifiedFacts, uncertainClaims e conflicts devono essere array di STRINGHE, non oggetti.";
function buildWebContext(webSearch) {
  const web = webSearch;
  if (!web) return "";
  const hasOrganic = (web.organic_results?.length ?? 0) > 0;
  const hasAnswer = Boolean(web.answer_box?.snippet);
  const hasKg = Boolean(web.knowledge_graph?.description);
  if (!hasOrganic && !hasAnswer && !hasKg) return "";
  return "\n\nRicerca web (Google via SerpApi \u2014 usa per affinare la sintesi, non ignorare conflitti con OCR/DB):\n" + JSON.stringify(
    {
      query: web.query,
      answer_box: web.answer_box,
      knowledge_graph: web.knowledge_graph,
      organic_results: web.organic_results?.slice(0, 5)
    },
    null,
    2
  );
}
function buildUserPrompt(evidence) {
  const { webSearch, supplyChain, ...evidenceCore } = evidence;
  return `Analizza queste evidenze prodotto e produci JSON:
{
  "summary": "4-6 frasi in italiano",
  "transparencyLevel": "high|medium|low",
  "verifiedFacts": ["stringa 1", "stringa 2"],
  "uncertainClaims": ["stringa 1"],
  "conflicts": ["stringa 1"]
}

Evidenze:
${JSON.stringify(evidenceCore, null, 2)}${buildWebContext(webSearch)}${buildSupplyChainContext(supplyChain)}`;
}
function buildSupplyChainContext(supplyChain) {
  if (!supplyChain) return "";
  return "\n\nProfilo filiera (origine prodotto e ingredienti \u2014 rispetta i livelli verified/partial/unavailable):\n" + JSON.stringify(supplyChain, null, 2);
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
var VISION_PROMPT = "Trascrivi fedelmente tutto il testo visibile su questa etichetta (alimentare, cosmetica o detergente). Includi: nome prodotto, marca, ingredienti/INCI, allergeni, avvertenze di sicurezza, codice EAN/barcode, peso netto, certificazioni e origine se presenti. NON inventare ingredienti o varianti chimiche: trascrivi solo ci\xF2 che \xE8 leggibile. Mantieni l'ordine e le righe originali. Restituisci SOLO il testo trascritto, senza commenti n\xE9 markdown.";
function enrichFromRawText(rawText) {
  const analysis = analyzeOcrText(rawText);
  const text = analysis.cleanedText;
  const hints = inferHintsFromRawText(text);
  const lower = text.toLowerCase();
  const labelClaims = [];
  for (const kw of ["bio", "organic", "vegan", "gluten free", "senza glutine", "fair trade", "dop", "igp"]) {
    if (lower.includes(kw)) labelClaims.push(kw);
  }
  const originClaims = parseOriginsFromText(text).map(
    (c) => c.ingredient ? `${c.ingredient}: ${c.place}` : c.place
  );
  return {
    rawText: text,
    productName: hints.productName,
    brand: hints.brand,
    ingredients: analysis.ingredients,
    labelKind: analysis.labelKind,
    warnings: analysis.warnings.length ? analysis.warnings : void 0,
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
    labelKind: enriched.labelKind,
    warnings: enriched.warnings,
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
var VERCEL_MAX_FILE_BYTES = 900 * 1024;
var upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: VERCEL_MAX_FILE_BYTES }
});
var analyzeUpload = upload.fields([
  { name: "image", maxCount: 1 },
  { name: "productImages", maxCount: maxProductImages }
]);
var productVisionUpload = upload.array("productImages", maxProductImages);
async function runAnalysis(input) {
  const evidence = await buildProductEvidence(input);
  const analysis = await analyzeWithAi(evidence);
  return { evidence, analysis };
}
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
function multerErrorMessage(err) {
  if (err && typeof err === "object" && "code" in err && err.code === "LIMIT_FILE_SIZE") {
    return "Immagine troppo grande (max ~900KB). Riduci la foto e riprova.";
  }
  return err instanceof Error ? err.message : "Errore upload";
}
apiRouter.post("/product/vision", productVisionUpload, async (req, res) => {
  try {
    const files = req.files;
    if (!files?.length) {
      res.status(400).json({ error: "Almeno una foto prodotto richiesta (productImages)" });
      return;
    }
    const productVision = await describeProductFromImages(
      files.map((f) => ({ buffer: f.buffer, mimeType: f.mimetype }))
    );
    res.json({ success: true, productVision });
  } catch (err) {
    res.status(503).json({ success: false, error: multerErrorMessage(err) });
  }
});
apiRouter.post("/analyze/json", async (req, res) => {
  try {
    const body = req.body;
    const response = await runAnalysis({
      ocr: body.ocr,
      productVision: body.productVision,
      barcode: body.barcode?.trim() || body.ocr?.barcode,
      productName: body.productName?.trim() || body.ocr?.productName || body.productVision?.productName,
      brand: body.brand?.trim() || body.ocr?.brand || body.productVision?.brand
    });
    res.json(response);
  } catch (err) {
    const message = err instanceof Error ? err.message : "Errore analisi";
    res.status(500).json({ error: message });
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
    const message = multerErrorMessage(err);
    res.status(message.includes("troppo grande") ? 413 : 503).json({
      success: false,
      error: message,
      hint: "Verifica token/product_id e INFOMANIAK_VISION_MODEL (es. mistralai/Ministral-3-14B-Instruct-2512)"
    });
  }
});
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
    const response = await runAnalysis({
      barcode,
      ocr,
      productVision,
      productName: req.body.productName ? String(req.body.productName) : ocr?.productName ?? productVision?.productName,
      brand: req.body.brand ? String(req.body.brand) : ocr?.brand ?? productVision?.brand
    });
    res.json(response);
  } catch (err) {
    const message = multerErrorMessage(err);
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
    const response = await runAnalysis({ barcode });
    res.json(response);
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
