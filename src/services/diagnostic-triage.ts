/**
 * Dominant-track routing for the diagnostic **job** snapshot.
 * Map: rint-app/docs/DIAGNOSIS-DOMINANT.md
 *
 * Closed URL still wins first (track_pdp). Shopify connected without this
 * product (not marketplace) is also track_pdp. Citation gap and hard
 * price/brand mismatch on the client object are track_llm. Thin Admin
 * (description/attrs) is track_llm when JSON-LD is already on the street.
 * Open street without JSON-LD is track_pdp even if Admin is thin — job and
 * screen must agree or the week glass is empty. `track_produto` needs a competitor (or store) object in
 * `objetos_citados` — a name string without objects is not an offer to compare.
 * After N/N + street ok: Product before Media. Media waste is conventional Meta
 * only (CAC > card price or spend with zero purchases) — not Google Ads / Merchant.
 */

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

/**
 * Conventional Meta Ads only (MVP). Google Ads / Merchant / AI-channel ads
 * do not pick the week — do not invent waste from v2 ports.
 * Sick paid: CAC above **card** (SKU currentPrice), or spend with zero purchases.
 * Ticket médio is Conta 1 / margin evidence — not the waste gate.
 */
function hasMediaWaste(signals: TriageInput["mediaSignals"], cardPrice: number): boolean {
  const meta = signals?.meta;
  if (!meta) return false;

  const spend = meta.spend ?? 0;
  const conversions = meta.conversions ?? 0;
  if (spend > 0 && conversions === 0) return true;

  const cac = meta.cac ?? 0;
  const card = cardPrice > 0 ? cardPrice : 0;
  return cac > 0 && card > 0 && cac > card;
}

export function publicStorefrontUnreadable(snapshot: ShopifyProductSnapshot): boolean {
  const access = snapshot.meta.storefrontAccess;
  if (access === "password" || access === "blocked") return true;
  if (access === "open" || access === "unverified") return false;
  // Legacy Shopify Admin snapshot with no public GET recorded.
  return snapshot.meta.source === "shopify_api" && snapshot.meta.hasJsonLd == null;
}

function catalogFoundationThin(snapshot: ShopifyProductSnapshot): boolean {
  const gaps = snapshot.meta.admin?.gaps ?? [];
  return gaps.includes("attributes") || gaps.includes("description");
}

function panelMismatch(snapshot: ShopifyProductSnapshot): boolean {
  return snapshot.meta.panelMismatch === true;
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
      isCitedClientObject(
        object,
        client,
        object.grounding_confirmed_client ?? query.cliente_foi_citado,
      ),
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
  const citationTotal = input.queries.length;
  const citationClient = input.queries.filter((query) => query.cliente_foi_citado).length;
  const citationGap = citationTotal > 0 && citationClient < citationTotal;
  const competitorCited = input.queries.some((query) => {
    const shopify = skuById.get(query.sku_id);
    const client = shopify ? { name: shopify.name, brand: shopify.brand, url: shopify.url } : null;
    const listed = Array.isArray(query.gemini_structured.objetos_citados)
      ? query.gemini_structured.objetos_citados
      : [];
    return listed.some((object) => {
      const named = Boolean(
        object.produto?.trim() || object.marca?.trim() || object.loja?.trim() || object.url?.trim(),
      );
      if (!named) return false;
      if (
        client &&
        isCitedClientObject(
          object,
          client,
          object.grounding_confirmed_client ?? query.cliente_foi_citado,
        )
      )
        return false;
      return true;
    });
  });

  let coherenceLevel: CoherenceLevel = "coerente";
  if (hardMismatch) coherenceLevel = "incoerente";
  else if (partialMismatch) coherenceLevel = "parcialmente_coerente";

  let track: DiagnosticTrack;
  const storefrontClosed = input.skus.some((sku) => publicStorefrontUnreadable(sku.shopify));
  const shopMismatch = input.skus.some((sku) => panelMismatch(sku.shopify));
  const thinCatalog = input.skus.some((sku) => catalogFoundationThin(sku.shopify));
  const missingStreetSchema = input.skus.some((sku) => {
    const access = sku.shopify.meta.storefrontAccess;
    const shopOnRun =
      sku.shopify.meta.source === "shopify_api" ||
      sku.shopify.meta.shopConnected === true ||
      sku.shopify.meta.panelMismatch === true;
    return shopOnRun && access === "open" && sku.shopify.meta.hasJsonLd === false;
  });
  const unverifiedStreet = input.skus.some(
    (sku) => sku.shopify.meta.storefrontAccess === "unverified",
  );
  if (storefrontClosed) {
    // Admin catalog is not the vitrine — AI cannot index a password wall.
    track = "track_pdp";
  } else if (shopMismatch) {
    track = "track_pdp";
  } else if (coherenceLevel === "incoerente") {
    track = "track_llm";
  } else if (citationGap) {
    track = "track_llm";
  } else if (missingStreetSchema || unverifiedStreet) {
    track = "track_pdp";
  } else if (coherenceLevel === "parcialmente_coerente" || thinCatalog) {
    track = "track_llm";
  } else if (competitorCited) {
    // Product before media — do not scale ads of a SKU the model already rejected.
    track = "track_produto";
  } else if (hasMediaWaste(input.mediaSignals, input.skus[0]?.shopify.currentPrice ?? 0)) {
    track = "track_midia";
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
      media_waste_detected: hasMediaWaste(
        input.mediaSignals,
        input.skus[0]?.shopify.currentPrice ?? 0,
      ),
      storefront_not_public: storefrontClosed,
      comparisons: checks,
    },
  };
}
