import { DATABASE_CATALOG, type DatabaseMeta } from "./databaseCatalog";

export interface DatabaseInfoEntry extends DatabaseMeta {
  /** Breve descrizione della fonte */
  summary: string;
  /** Cosa restituisce concretamente */
  contains: string[];
  /** Come viene interrogata dall'app */
  queryHint: string;
  /** Chiave .env richiesta, se presente */
  envKey?: string;
  /** Nota operativa (limiti, fallback, ecc.) */
  note?: string;
}

export const DATABASE_INFO: DatabaseInfoEntry[] = [
  {
    ...DATABASE_CATALOG.find((d) => d.id === "open_food_facts")!,
    summary: "Database open-source di prodotti alimentari, crowdsourced a livello mondiale.",
    contains: [
      "Nome, marca, categorie",
      "Ingredienti e allergeni",
      "Paesi, origini e luoghi di produzione",
      "Etichette e certificazioni (bio, DOP, ecc.)",
      "Immagini prodotto",
    ],
    queryHint: "EAN-13 / barcode oppure ricerca per nome e marca se manca il codice.",
    note: "Prima fonte interrogata dal resolver universale Open Facts.",
  },
  {
    ...DATABASE_CATALOG.find((d) => d.id === "open_beauty_facts")!,
    summary: "Database open-source per cosmetici, skincare e prodotti beauty.",
    contains: [
      "Nome, marca, categorie",
      "Ingredienti INCI",
      "Paesi e origini",
      "Label (cruelty-free, vegan, dermatologico, ecc.)",
      "Immagini prodotto",
    ],
    queryHint: "EAN-13 / barcode oppure ricerca per nome e marca.",
    note: "Stessa infrastruttura di Open Food Facts, dominio dedicato beauty.",
  },
  {
    ...DATABASE_CATALOG.find((d) => d.id === "open_products_facts")!,
    summary: "Database open-source per prodotti non alimentari (es. articoli vari, tabacco).",
    contains: [
      "Nome, marca, categorie",
      "Paesi e origini",
      "Etichette prodotto",
      "Immagini",
    ],
    queryHint: "EAN-13 / barcode oppure ricerca per nome e marca.",
    note: "Usato quando il prodotto non è classificato come food o beauty.",
  },
  {
    ...DATABASE_CATALOG.find((d) => d.id === "gs1")!,
    summary: "Lookup pubblico del codice a barre (GTIN) tramite UPCitemdb.",
    contains: [
      "Descrizione prodotto",
      "Marca / azienda",
      "Titolo commerciale",
    ],
    queryHint: "Solo EAN-13 / barcode — non accetta ricerca per nome.",
    note: "Dati barcode pubblici, non è GS1 Verified ufficiale. Piano trial con possibili rate limit.",
  },
  {
    ...DATABASE_CATALOG.find((d) => d.id === "certifications_db")!,
    summary: "Certificazioni estratte dalle etichette Open Facts del prodotto trovato.",
    contains: [
      "Bio / organic",
      "DOP, IGP, PDO",
      "Vegan, cruelty-free",
      "FSC, GOTS, Fair Trade, EU Ecolabel",
      "Altre label riconosciute nei tag OFF",
    ],
    queryHint: "Solo EAN-13 — deriva dai dati Open Facts, non ha API autonoma.",
    note: "Se il prodotto non è su Open Facts, le certificazioni restano vuote.",
  },
  {
    ...DATABASE_CATALOG.find((d) => d.id === "customs_un_comtrade")!,
    summary: "Informazioni doganali: codice HS e paese di origine/import.",
    contains: [
      "Codice HS inferito dalla categoria prodotto",
      "Paese da origini / produzione / paesi OFF",
      "Dati commerciali UN Comtrade (se configurato)",
    ],
    queryHint: "Solo EAN-13 — usa categorie e geografia da Open Facts.",
    envKey: "UN_COMTRADE_API_KEY",
    note: "Senza chiave Comtrade: solo inferenza da categorie OFF. Reporter predefinito: Italia (380).",
  },
  {
    ...DATABASE_CATALOG.find((d) => d.id === "serp_api")!,
    summary: "Google Shopping via SerpApi — listing online del prodotto.",
    contains: [
      "Titolo e venditore",
      "Prezzo e link acquisto",
      "Eventuale «made in …» dal titolo",
      "Fino a 5 risultati shopping",
    ],
    queryHint: "Nome prodotto (+ marca consigliata). Barcode opzionale come termine aggiuntivo.",
    envKey: "SERP_API_KEY",
    note: "Richiede account su serpapi.com. Senza chiave la fonte viene saltata.",
  },
];

/** Etichetta leggibile per searchBy */
export function formatSearchBy(searchBy: DatabaseMeta["searchBy"]): string {
  const hasBarcode = searchBy.includes("barcode");
  const hasName = searchBy.includes("name");
  if (hasBarcode && hasName) return "EAN · nome";
  if (hasBarcode) return "Solo EAN";
  if (hasName) return "Solo nome";
  return "—";
}
