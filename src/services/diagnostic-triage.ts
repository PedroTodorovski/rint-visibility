import { citedObjectsFromStructured, isCitedClientObject } from "../lib/llm/gemini-structured.js";
import type {
  GoogleAdsSkuWaste,
  MerchantCenterProductStatus,
  MetaSkuCac,
  ShopifySkuRevenue,
} from "../ports/types.js";
import type { DiagnosticQueryRow } from "../repositories/diagnostic-tables.js";
import type {
  CoherenceLevel,
  DiagnosticTrack,
  GeminiCitedObject,
  ShopifyProductSnapshot,
} from "./diagnostic-types.js";

export type TriageInput = {
  skus: Array<{ id: string; shopify: ShopifyProductSnapshot }>;
  queries: DiagnosticQueryRow[];
  mediaSignals?: {
    meta?: MetaSkuCac | null;
    googleAds?: GoogleAdsSkuWaste | null;
    merchantCenter?: MerchantCenterProductStatus | null;
    shopifyRevenue?: ShopifySkuRevenue | null;
  };
};

export type TriageOutcome = {
  coherenceLevel: CoherenceLevel;
  track: DiagnosticTrack;
  checks: Record<string, unknown>;
};

function normalized(text: string | null | undefined): string {
  return (text ?? "")
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "")
    .toLowerCase()
    .trim();
}

function priceMatches(cited: number | null, real: number): boolean | null {
  if (cited === null || cited <= 0 || real <= 0) return null;
  const delta = Math.abs(cited - real) / real;
  return delta <= 0.03;
}

function attributesExist(cited: string[], real: string[]): boolean | null {
  if (cited.length === 0) return null;
  const realText = normalized(real.join(" "));
  return cited.every((attribute) => {
    const token = normalized(attribute)
      .split(/\W+/)
      .filter((part) => part.length >= 3)[0];
    return token ? realText.includes(token) : false;
  });
}

function brandMatchesObject(
  object: GeminiCitedObject,
  shopify: ShopifyProductSnapshot,
): boolean | null {
  const cited = normalized(object.marca ?? object.produto);
  if (!cited) return null;
  const realNames = [shopify.name, shopify.brand].map(normalized).filter(Boolean);
  return realNames.some(
    (name) => name.includes(cited) || cited.includes(name.split(/\s+/)[0] ?? name),
  );
}

function mergeCheck(current: boolean | null, next: boolean | null): boolean | null {
  if (next === false || current === false) return false;
  if (next === true || current === true) return true;
  return null;
}

function hasMediaWaste(signals: TriageInput["mediaSignals"]): boolean {
  const googleWaste = signals?.googleAds?.wastedSpend;
  if (typeof googleWaste === "number" && googleWaste > 0) return true;

  const merchant = signals?.merchantCenter;
  if (
    merchant?.approved === false ||
    merchant?.gtinValid === false ||
    merchant?.priceMatchesShopify === false
  ) {
    return true;
  }

  const cac = signals?.meta?.cac ?? 0;
  const ticket = signals?.shopifyRevenue?.ticketMedio ?? 0;
  return cac > 0 && ticket > 0 && cac > ticket;
}

export function computeTriage(input: TriageInput): TriageOutcome {
  const skuById = new Map(input.skus.map((sku) => [sku.id, sku.shopify]));
  const checks: Array<Record<string, unknown>> = [];
  let hardMismatch = false;
  let partialMismatch = false;

  for (const query of input.queries) {
    const shopify = skuById.get(query.sku_id);
    if (!shopify) continue;
    const client = { name: shopify.name, brand: shopify.brand, url: shopify.url };
    const clientObjects = citedObjectsFromStructured(query.gemini_structured).filter((object) =>
      isCitedClientObject(object, client),
    );
    let price: boolean | null = null;
    let attrs: boolean | null = null;
    let brand: boolean | null = null;
    for (const object of clientObjects) {
      price = mergeCheck(price, priceMatches(object.preco, shopify.currentPrice));
      attrs = mergeCheck(attrs, attributesExist(object.atributos, shopify.attributes));
      brand = mergeCheck(brand, brandMatchesObject(object, shopify));
    }

    checks.push({
      query_id: query.id,
      price_matches: price,
      attributes_exist: attrs,
      brand_matches: brand,
      client_cited: query.cliente_foi_citado,
    });

    if (price === false || brand === false) hardMismatch = true;
    if (attrs === false) partialMismatch = true;
  }

  const clientCited = input.queries.some((query) => query.cliente_foi_citado);
  const competitorCited = input.queries.some(
    (query) => query.concorrente_citado_nome || query.concorrente_citado_url,
  );

  let coherenceLevel: CoherenceLevel = "coerente";
  if (hardMismatch) coherenceLevel = "incoerente";
  else if (partialMismatch) coherenceLevel = "parcialmente_coerente";

  let track: DiagnosticTrack;
  if (coherenceLevel === "incoerente") {
    track = "track_llm";
  } else if (coherenceLevel === "parcialmente_coerente") {
    track = "track_pdp";
  } else if (!clientCited && hasMediaWaste(input.mediaSignals)) {
    track = "track_midia";
  } else if (!clientCited || competitorCited) {
    track = "track_produto";
  } else {
    track = "track_pdp";
  }

  return {
    coherenceLevel,
    track,
    checks: {
      one_dominant_track: true,
      client_cited: clientCited,
      competitor_cited: competitorCited,
      media_waste_detected: hasMediaWaste(input.mediaSignals),
      comparisons: checks,
    },
  };
}
