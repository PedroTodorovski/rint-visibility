/** Pontual OfferReader for a cited checkout — not a competitor catalog. */

import {
  type CitedObjectLike,
  checkoutHostFitsSeller,
  hostFromUrl,
  isLikelyProductUrl,
  productIdentityKey,
} from "./cited-offer.js";
import { mercadoLivreReader, type OfferReader, vtexReader } from "./cited-offer-adapters.js";
import { isGoogleRedirect, resolveGroundingUrls } from "./grounding-resolve.js";
import { type GeminiStructuredOutput, hydrateGeminiStructured } from "./llm/gemini-structured.js";
import { fetchPublicPdp, parsePublicPdpHtml } from "./pdp-identity.js";
import { canonicalProductUrl } from "./product-url-gate.js";
import {
  type CitedName,
  canonicalGuaranteeAttr,
  certQualityLabel,
  emptyShopperOffer,
  groundingFitsCited,
  httpsProductImageUrl,
  isCompleteProductImageUrl,
  mergeShopperOffer,
  offerMatchesCited,
  type ShopperOffer,
  shopperOfferFromIdentity,
  shopperOfferHasFact,
  shopperOfferNeedsHtmlEnrichment,
} from "./shopper-offer.js";

export type { ShopperOffer } from "./shopper-offer.js";
export {
  isEditorialMediaUrl,
  isProductImageUrl,
  offerMatchesCited,
  shopperOfferFromIdentity,
} from "./shopper-offer.js";

export type CitedImageLayer = "json_ld" | "og";

export type CitedImageHit = {
  url: string;
  layer: CitedImageLayer;
};

export type CitedShopperFacts = {
  preco: number | null;
  moeda: string | null;
  avaliacao: string | null;
  prazo_entrega: string | null;
  dimensoes: string | null;
  qualidade: string | null;
  atributos: string[];
  url: string | null;
};

const EMPTY_SHOPPER_FACTS: CitedShopperFacts = {
  preco: null,
  moeda: null,
  avaliacao: null,
  prazo_entrega: null,
  dimensoes: null,
  qualidade: null,
  atributos: [],
  url: null,
};

const PDP_FETCH_CAP = 3;

export const htmlReader: OfferReader = {
  id: "html",
  canRead: () => true,
  read: async (url, fetchImpl = fetch) => {
    const page = await fetchPublicPdp(url, fetchImpl);
    if (!page.alive || page.blocked || !page.html) return emptyShopperOffer();
    const resolved = page.url || url;
    if (!isLikelyProductUrl(resolved)) return emptyShopperOffer();
    return shopperOfferFromIdentity(page.identity, resolved, hostFromUrl(resolved));
  },
};

export const OFFER_READERS: OfferReader[] = [mercadoLivreReader, vtexReader, htmlReader];

export function pickOfferReader(url: string): OfferReader {
  return OFFER_READERS.find((reader) => reader.canRead(url) && reader.id !== "html") ?? htmlReader;
}

/** One refuse: final URL is not a PDP, or structured name/URL is not this SKU. */
export function refuseCitedOffer(
  pageUrl: string,
  offer: ShopperOffer,
  cited: CitedName | null,
): boolean {
  if (!isLikelyProductUrl(pageUrl)) return true;
  if (cited && !offerMatchesCited({ name: offer.name, url: pageUrl }, cited)) return true;
  return false;
}

export function shopperFactsFromOffer(offer: ShopperOffer): CitedShopperFacts {
  const guarantee = canonicalGuaranteeAttr(offer.guarantee);
  const attrs = [...offer.attrs];
  if (guarantee && !attrs.some((attr) => /^garantia\s*:/i.test(attr))) {
    attrs.unshift(guarantee);
  }
  return {
    preco: offer.price,
    moeda: offer.currency,
    avaliacao: offer.rating,
    prazo_entrega: offer.shipping,
    dimensoes: offer.dose,
    qualidade: certQualityLabel(offer.quality),
    atributos: attrs.slice(0, 16),
    url: offer.pageUrl,
  };
}

function imageHitFromOffer(offer: ShopperOffer): CitedImageHit | null {
  const url = httpsProductImageUrl(offer.imageUrl, offer.pageUrl);
  if (!url) return null;
  return { url, layer: "og" };
}

/** JSON-LD Product.image, else og:image. No twitter, no search thumb, no invented path. */
export function pickCitedImageFromHtml(html: string, baseUrl: string): CitedImageHit | null {
  const identity = parsePublicPdpHtml(html, baseUrl);
  const url = httpsProductImageUrl(identity.image, baseUrl);
  if (!url) return null;
  return { url, layer: identity.imageSource === "json_ld" ? "json_ld" : "og" };
}

async function readWithFallback(url: string, fetchImpl: typeof fetch): Promise<ShopperOffer> {
  const selected = pickOfferReader(url);
  const offer = await selected.read(url, fetchImpl);
  if (selected.id === "html" || !shopperOfferNeedsHtmlEnrichment(offer)) return offer;
  return mergeShopperOffer(offer, await htmlReader.read(url, fetchImpl));
}

export function groundingUrlsForCitedObject(
  urls: string[],
  cited: CitedName,
  titles: Array<{ url: string; title?: string | null }> = [],
): string[] {
  const titleByUrl = new Map(titles.map((row) => [row.url, row.title ?? null]));
  const fitted: string[] = [];
  const google: string[] = [];
  const seen = new Set<string>();
  for (const raw of urls) {
    const href = raw.trim();
    if (!href || seen.has(href)) continue;
    if (isGoogleRedirect(href)) {
      seen.add(href);
      google.push(href);
      continue;
    }
    if (!groundingFitsCited(href, titleByUrl.get(href), cited)) continue;
    seen.add(href);
    fitted.push(href);
  }
  return fitted.length > 0 ? fitted : google;
}

function pushCitedPdp(
  out: string[],
  seen: Set<string>,
  href: string,
  cited: CitedName | null,
  title: string | null,
  isPrimary: boolean,
): boolean {
  const dest = canonicalProductUrl(href);
  if (!dest || seen.has(dest)) return false;
  if (cited && !isPrimary && !groundingFitsCited(dest, title, cited)) return false;
  seen.add(dest);
  out.push(dest);
  return out.length >= PDP_FETCH_CAP;
}

export async function collectCitedPdpUrls(input: {
  productUrl?: string | null;
  groundingUrls?: string[] | null;
  cited?: CitedName | null;
  fetchImpl?: typeof fetch;
}): Promise<string[]> {
  const fetchImpl = input.fetchImpl ?? fetch;
  const cited = input.cited ?? null;
  const productUrl = input.productUrl?.trim() || "";
  const raw = [productUrl, ...(input.groundingUrls ?? []).map((href) => href.trim())].filter(
    Boolean,
  );
  const ready: string[] = [];
  const needResolve: string[] = [];
  const seenRaw = new Set<string>();
  for (const href of raw) {
    if (!href || seenRaw.has(href)) continue;
    seenRaw.add(href);
    if (isGoogleRedirect(href)) needResolve.push(href);
    else ready.push(href);
  }
  const out: string[] = [];
  const seen = new Set<string>();
  for (const href of ready) {
    const isPrimary = Boolean(productUrl && href === productUrl);
    if (pushCitedPdp(out, seen, href, cited, null, isPrimary)) return out;
  }
  if (out.length > 0) return out;
  const resolved = await resolveGroundingUrls(needResolve, fetchImpl);
  for (const row of resolved) {
    const href = (row.to || "").trim();
    const isPrimary = Boolean(
      productUrl && (row.from === productUrl || href === productUrl || row.to === productUrl),
    );
    if (pushCitedPdp(out, seen, href, cited, row.title ?? null, isPrimary)) break;
  }
  return out;
}

export async function readCitedOffer(input: {
  productUrl?: string | null;
  groundingUrls?: string[] | null;
  cited?: CitedName | null;
  seller?: string | null;
  fetchImpl?: typeof fetch;
}): Promise<ShopperOffer> {
  const fetchImpl = input.fetchImpl ?? fetch;
  const cited = input.cited ?? null;
  const urls = await collectCitedPdpUrls({ ...input, fetchImpl });
  const onSeller = urls.filter((href) => checkoutHostFitsSeller(href, input.seller));
  const tryUrls = input.seller?.trim() && onSeller.length > 0 ? onSeller : urls;
  for (const href of tryUrls) {
    const offer = await readWithFallback(href, fetchImpl);
    const pageUrl = offer.pageUrl || href;
    if (refuseCitedOffer(pageUrl, offer, cited)) continue;
    if (!shopperOfferHasFact(offer)) continue;
    return { ...offer, pageUrl };
  }
  return emptyShopperOffer();
}

export async function resolveCitedOfferPage(input: {
  imagemUrl?: string | null;
  productUrl?: string | null;
  groundingUrls?: string[] | null;
  cited?: CitedName | null;
  seller?: string | null;
  fetchImpl?: typeof fetch;
}): Promise<{
  image: CitedImageHit | null;
  facts: CitedShopperFacts;
  pageUrl: string | null;
  offer: ShopperOffer;
}> {
  void input.imagemUrl;
  const offer = await readCitedOffer(input);
  if (!shopperOfferHasFact(offer)) {
    return { image: null, facts: EMPTY_SHOPPER_FACTS, pageUrl: null, offer };
  }
  const image = imageHitFromOffer(offer);
  const facts = shopperFactsFromOffer(offer);
  return { image, facts, pageUrl: offer.pageUrl, offer };
}

export async function resolveCitedOfferImage(input: {
  imagemUrl?: string | null;
  productUrl?: string | null;
  groundingUrls?: string[] | null;
  cited?: CitedName | null;
  fetchImpl?: typeof fetch;
}): Promise<CitedImageHit | null> {
  const page = await resolveCitedOfferPage(input);
  return page.image;
}

function keepCitedImage(current: string | null | undefined): boolean {
  return isCompleteProductImageUrl(current);
}

function keepCitedProductUrl(current: string | null | undefined): string | null {
  const href = current?.trim() || "";
  if (!href || isGoogleRedirect(href)) return null;
  return canonicalProductUrl(href);
}

export function stampCitedImage<T extends CitedObjectLike>(
  objects: T[],
  productKey: string,
  url: string,
): T[] {
  const href = httpsProductImageUrl(url);
  if (!href) return objects;
  return objects.map((object) => {
    if (productIdentityKey(object) !== productKey) return object;
    if (keepCitedImage(object.imagem_url)) return object;
    return { ...object, imagem_url: href };
  });
}

export function stampStructuredCitedImage(
  structured: GeminiStructuredOutput,
  productKey: string,
  url: string,
): GeminiStructuredOutput {
  return hydrateGeminiStructured({
    ...structured,
    objetos_citados: stampCitedImage(structured.objetos_citados, productKey, url),
  });
}

function mergeCitedAttrs(existing: string[] | null | undefined, incoming: string[]): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  for (const raw of [...(existing ?? []), ...incoming]) {
    const item = raw.trim();
    if (!item) continue;
    const key = item
      .normalize("NFD")
      .replace(/\p{Diacritic}/gu, "")
      .toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(item);
  }
  return out.slice(0, 16);
}

export function stampCitedShopperFacts<T extends CitedObjectLike>(
  objects: T[],
  productKey: string,
  facts: CitedShopperFacts,
  options?: { fromCheckout?: boolean; dropUrl?: boolean },
): T[] {
  const fromCheckout = Boolean(options?.fromCheckout && keepCitedProductUrl(facts.url));
  return objects.map((object) => {
    if (productIdentityKey(object) !== productKey) return object;
    if (options?.dropUrl) {
      return { ...object, url: null };
    }
    if (fromCheckout) {
      return {
        ...object,
        preco: facts.preco,
        moeda: facts.moeda?.trim() || null,
        avaliacao: facts.avaliacao?.trim() || null,
        prazo_entrega: facts.prazo_entrega?.trim() || null,
        dimensoes: facts.dimensoes?.trim() || object.dimensoes?.trim() || null,
        qualidade: certQualityLabel(facts.qualidade),
        url: keepCitedProductUrl(facts.url),
        atributos: mergeCitedAttrs(facts.atributos, object.atributos ?? []),
      };
    }
    return {
      ...object,
      preco: object.preco ?? facts.preco,
      moeda: object.moeda?.trim() || facts.moeda,
      avaliacao: object.avaliacao?.trim() || facts.avaliacao,
      prazo_entrega: object.prazo_entrega?.trim() || facts.prazo_entrega,
      dimensoes: object.dimensoes?.trim() || facts.dimensoes,
      qualidade: certQualityLabel(object.qualidade) || certQualityLabel(facts.qualidade),
      url: keepCitedProductUrl(object.url) || facts.url,
      atributos: mergeCitedAttrs(object.atributos, facts.atributos),
    };
  });
}

export function stampStructuredCitedFacts(
  structured: GeminiStructuredOutput,
  productKey: string,
  facts: CitedShopperFacts,
  options?: { fromCheckout?: boolean; dropUrl?: boolean },
): GeminiStructuredOutput {
  return hydrateGeminiStructured({
    ...structured,
    objetos_citados: stampCitedShopperFacts(structured.objetos_citados, productKey, facts, options),
  });
}
