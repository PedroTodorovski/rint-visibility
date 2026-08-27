import { foldIdentity } from "./cited-offer.js";
import type { PublicPdpIdentity } from "./pdp-identity.js";

/** Same shape on both vs sides. Reader output — never HTML. */
export type ShopperOffer = {
  pageUrl: string | null;
  name: string | null;
  seller: string | null;
  imageUrl: string | null;
  price: number | null;
  currency: string | null;
  rating: string | null;
  shipping: string | null;
  guarantee: string | null;
  dose: string | null;
  quality: string | null;
  attrs: string[];
};

export type CitedName = {
  marca?: string | null;
  produto?: string | null;
};

const QUALITY_NEEDLES = ["nsf", "anvisa", "certif", "selo", "vegan", "qualidade", "quality"];
const CERT_QUALITY_NEEDLES = ["nsf", "anvisa", "inmetro", "iso", "certif", "selo"];
const GUARANTEE_NEEDLES = ["garantia", "warranty", "guarantee"];
const DOSE_NEEDLES = ["dose", "scoop", "porcao", "porção", "capsula", "cápsula", "nutriente"];

export function emptyShopperOffer(): ShopperOffer {
  return {
    pageUrl: null,
    name: null,
    seller: null,
    imageUrl: null,
    price: null,
    currency: null,
    rating: null,
    shipping: null,
    guarantee: null,
    dose: null,
    quality: null,
    attrs: [],
  };
}

export function isEditorialMediaUrl(raw: string): boolean {
  try {
    const url = new URL(raw);
    const host = url.hostname.toLowerCase().replace(/^www\./, "");
    if (
      host === "healthline.com" ||
      host.endsWith(".healthline.com") ||
      host.endsWith("rvohealth.io") ||
      host === "webmd.com" ||
      host.endsWith(".webmd.com")
    ) {
      return true;
    }
    return /\/(blogs?|artigos?|noticias?|news|mageplaza\/blog)\b/i.test(url.pathname);
  } catch {
    return false;
  }
}

/** Search-engine thumbs are not the checkout photo. */
export function isSearchThumbnailUrl(raw: string): boolean {
  try {
    const host = new URL(raw).hostname.toLowerCase();
    if (host.includes("encrypted-tbn")) return true;
    if (
      host.endsWith("gstatic.com") &&
      /\/(images|shopping|favicon)/i.test(new URL(raw).pathname)
    ) {
      return true;
    }
    if (host.includes("vertexaisearch")) return true;
    return false;
  } catch {
    return true;
  }
}

/** Gemini often truncates VTEX paths before `.jpg`. Keep Shopify CDNs even without an extension. */
export function isCompleteProductImageUrl(raw: string | null | undefined): boolean {
  if (!isProductImageUrl(raw)) return false;
  try {
    const path = new URL(raw!.trim()).pathname.toLowerCase();
    if (/\.(jpe?g|png|webp|gif|avif)$/.test(path)) return true;
    if (path.includes("/s/files/") || path.includes("/cdn/shop/")) return true;
    return false;
  } catch {
    return false;
  }
}

export function certQualityLabel(value: string | null | undefined): string | null {
  const trimmed = value?.trim() || "";
  if (!trimmed) return null;
  const folded = foldIdentity(trimmed);
  if (CERT_QUALITY_NEEDLES.some((needle) => folded.includes(needle))) return trimmed;
  return null;
}

export function isProductImageUrl(raw: string | null | undefined): boolean {
  const href = raw?.trim() ?? "";
  if (!href) return false;
  try {
    const url = new URL(href);
    if (url.protocol === "http:") url.protocol = "https:";
    if (url.protocol !== "https:") return false;
    if (!url.hostname?.includes(".")) return false;
    if (isEditorialMediaUrl(url.href)) return false;
    if (isSearchThumbnailUrl(url.href)) return false;
    return true;
  } catch {
    return false;
  }
}

export function httpsProductImageUrl(
  raw: string | null | undefined,
  baseUrl?: string | null,
): string | null {
  const href = raw?.trim() ?? "";
  if (!href) return null;
  try {
    const url = baseUrl ? new URL(href, baseUrl) : new URL(href);
    if (url.protocol === "http:") url.protocol = "https:";
    return isProductImageUrl(url.href) ? url.href : null;
  } catch {
    return null;
  }
}

function identityTokens(value: string | null | undefined): string[] {
  return foldIdentity(value)
    .split(" ")
    .filter((token) => token.length >= 4);
}

function factFromAttrs(attrs: string[], needles: readonly string[]): string | null {
  for (const raw of attrs) {
    const sep = raw.indexOf(":");
    const name = (sep >= 0 ? raw.slice(0, sep) : raw).trim().toLowerCase();
    const value = (sep >= 0 ? raw.slice(sep + 1) : raw).trim();
    if (!value) continue;
    const folded = foldIdentity(name);
    if (needles.some((needle) => folded.includes(foldIdentity(needle)))) return value;
  }
  return null;
}

function hayWords(hay: string): Set<string> {
  return new Set(hay.split(" ").filter((word) => word.length >= 3));
}

export function offerMatchesCited(
  input: { name?: string | null; url?: string | null },
  cited: CitedName,
): boolean {
  const hay = foldIdentity([input.name, input.url].filter(Boolean).join(" "));
  if (!hay) return false;
  const hayCompact = hay.replace(/\s+/g, "");
  const words = hayWords(hay);
  const produtoFold = foldIdentity(cited.produto);
  const marcaFold = foldIdentity(cited.marca);
  const produtoCompact = produtoFold.replace(/\s+/g, "");
  const marcaCompact = marcaFold.replace(/\s+/g, "");
  if (!produtoCompact && !marcaCompact) return true;
  if (produtoCompact.length >= 3 && hayCompact.includes(produtoCompact)) return true;
  if (produtoFold.length >= 3 && hay.includes(produtoFold)) return true;
  const produtoHits = identityTokens(cited.produto).filter((token) => words.has(token));
  const marcaHits = identityTokens(cited.marca).filter((token) => words.has(token));
  if (produtoHits.length >= 1 && (marcaHits.length >= 1 || !marcaCompact)) return true;
  if (marcaCompact.length >= 4 && hayCompact.includes(marcaCompact) && produtoHits.length >= 1) {
    return true;
  }
  return false;
}

export function groundingFitsCited(
  url: string,
  title: string | null | undefined,
  cited: CitedName,
): boolean {
  return offerMatchesCited({ name: title ?? null, url }, cited);
}

export function shopperOfferFromIdentity(
  identity: PublicPdpIdentity,
  pageUrl: string | null,
  seller?: string | null,
): ShopperOffer {
  const attrs = identity.attributes ?? [];
  const imageUrl = httpsProductImageUrl(identity.image, pageUrl);
  const guarantee = factFromAttrs(attrs, GUARANTEE_NEEDLES);
  const quality = certQualityLabel(factFromAttrs(attrs, QUALITY_NEEDLES));
  const dose = identity.dimension?.trim() || factFromAttrs(attrs, DOSE_NEEDLES);
  const withGuarantee =
    guarantee && !attrs.some((attr) => foldIdentity(attr).includes("garantia"))
      ? [`Garantia: ${guarantee}`, ...attrs]
      : attrs;
  return {
    pageUrl: pageUrl?.trim() || null,
    name: identity.name,
    seller: seller?.trim() || null,
    imageUrl,
    price: identity.currentPrice > 0 ? identity.currentPrice : null,
    currency: identity.currency,
    rating: identity.rating,
    shipping: identity.shipping,
    guarantee,
    dose,
    quality,
    attrs: withGuarantee.slice(0, 16),
  };
}

export function shopperOfferHasFact(offer: ShopperOffer): boolean {
  return Boolean(
    offer.imageUrl ||
      offer.price != null ||
      offer.rating ||
      offer.shipping ||
      offer.guarantee ||
      offer.name,
  );
}

function foldAttrKey(value: string): string {
  return value
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "")
    .toLowerCase();
}

function pickCompleteImage(first: string | null, second: string | null): string | null {
  if (isCompleteProductImageUrl(first)) return first;
  if (isCompleteProductImageUrl(second)) return second;
  return first || second;
}

/** Platform JSON first; HTML fills only nulls. Same merge rule as the stamp. */
export function mergeShopperOffer(base: ShopperOffer, extra: ShopperOffer): ShopperOffer {
  const attrs: string[] = [];
  const seen = new Set<string>();
  for (const raw of [...base.attrs, ...extra.attrs]) {
    const item = raw.trim();
    if (!item) continue;
    const key = foldAttrKey(item);
    if (seen.has(key)) continue;
    seen.add(key);
    attrs.push(item);
  }
  return {
    pageUrl: base.pageUrl || extra.pageUrl,
    name: base.name || extra.name,
    seller: base.seller || extra.seller,
    imageUrl: pickCompleteImage(base.imageUrl, extra.imageUrl),
    price: base.price ?? extra.price,
    currency: base.currency || extra.currency,
    rating: base.rating || extra.rating,
    shipping: base.shipping || extra.shipping,
    guarantee: base.guarantee || extra.guarantee,
    dose: base.dose || extra.dose,
    quality: certQualityLabel(base.quality) || certQualityLabel(extra.quality),
    attrs: attrs.slice(0, 16),
  };
}

/** A name from VTEX/ML is not a full checkout card — still read the page for rating/shipping. */
export function shopperOfferNeedsHtmlEnrichment(offer: ShopperOffer): boolean {
  return (
    !shopperOfferHasFact(offer) ||
    offer.price == null ||
    !offer.imageUrl ||
    !offer.rating ||
    !offer.shipping
  );
}

export function canonicalGuaranteeAttr(guarantee: string | null | undefined): string | null {
  const value = guarantee?.trim();
  return value ? `Garantia: ${value}` : null;
}
