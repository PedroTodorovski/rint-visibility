import { OFFER_FETCH_TIMEOUT_MS, offerJsonHeaders } from "./offer-fetch.js";
import { emptyShopperOffer, httpsProductImageUrl, type ShopperOffer } from "./shopper-offer.js";

export type OfferReader = {
  id: "mercado_livre" | "vtex" | "html";
  canRead: (url: string) => boolean;
  read: (url: string, fetchImpl?: typeof fetch) => Promise<ShopperOffer>;
};

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function text(value: unknown): string | null {
  if (typeof value === "string" && value.trim()) return value.trim();
  if (typeof value === "number" && Number.isFinite(value)) return String(value);
  return null;
}

export function mercadoLivreItemId(url: string): string | null {
  try {
    const href = new URL(url);
    const host = href.hostname.toLowerCase().replace(/^www\./, "");
    if (!/mercadoli[vb]re\.com/.test(host)) return null;
    const fromPath = href.pathname.match(/\b(ML[A-Z]{1,3})-?(\d{6,})\b/i);
    if (fromPath) return `${fromPath[1].toUpperCase()}${fromPath[2]}`;
    const fromQuery = href.search.match(/\b(ML[A-Z]{1,3})-?(\d{6,})\b/i);
    if (fromQuery) return `${fromQuery[1].toUpperCase()}${fromQuery[2]}`;
    return null;
  } catch {
    return null;
  }
}

export function vtexSearchUrl(pdpUrl: string): string | null {
  try {
    const parsed = new URL(pdpUrl);
    const path = parsed.pathname.replace(/\/+$/, "");
    if (!/\/p$/i.test(path)) return null;
    return `${parsed.origin}/api/catalog_system/pub/products/search${path}`;
  } catch {
    return null;
  }
}

export function shopperOfferFromMercadoLivreItem(
  item: Record<string, unknown>,
  reviews: Record<string, unknown> | null,
  pageUrl: string,
): ShopperOffer {
  const pictures = Array.isArray(item.pictures) ? item.pictures : [];
  const firstPic = asRecord(pictures[0]);
  const imageUrl =
    httpsProductImageUrl(text(firstPic?.secure_url) ?? text(firstPic?.url), pageUrl) ??
    httpsProductImageUrl(text(item.secure_thumbnail) ?? text(item.thumbnail), pageUrl);
  const shipping = asRecord(item.shipping);
  const free = shipping?.free_shipping === true;
  const ratingValue =
    typeof reviews?.rating_average === "number" && Number.isFinite(reviews.rating_average)
      ? String(reviews.rating_average)
      : text(reviews?.rating_average);
  const ratingCount =
    typeof reviews?.total === "number" && Number.isFinite(reviews.total)
      ? String(reviews.total)
      : text(reviews?.total);
  const attrs: string[] = [];
  const list = Array.isArray(item.attributes) ? item.attributes : [];
  for (const row of list) {
    const record = asRecord(row);
    const name = text(record?.name);
    const value = text(record?.value_name);
    if (name && value) attrs.push(`${name}: ${value}`);
  }
  const guarantee = text(item.warranty);
  if (guarantee) attrs.unshift(`Garantia: ${guarantee}`);
  const price = typeof item.price === "number" && item.price > 0 ? item.price : null;
  return {
    ...emptyShopperOffer(),
    pageUrl: text(item.permalink) || pageUrl,
    name: text(item.title),
    seller: null,
    imageUrl,
    price,
    currency: text(item.currency_id),
    rating: ratingValue ? (ratingCount ? `${ratingValue} (${ratingCount})` : ratingValue) : null,
    shipping: free ? "Frete grátis" : null,
    guarantee,
    dose: null,
    quality:
      attrs.find((attr) => /anvisa|nsf|certif/i.test(attr))?.replace(/^[^:]+:\s*/, "") ?? null,
    attrs: attrs.slice(0, 16),
  };
}

export function shopperOfferFromVtexSearch(payload: unknown, pageUrl: string): ShopperOffer | null {
  const list = Array.isArray(payload) ? payload : [];
  const product = asRecord(list[0]);
  if (!product) return null;
  const items = Array.isArray(product.items) ? product.items : [];
  const item = asRecord(items[0]);
  const images = Array.isArray(item?.images) ? item.images : [];
  const image = asRecord(images[0]);
  const sellers = Array.isArray(item?.sellers) ? item.sellers : [];
  const seller = asRecord(sellers[0]);
  const offer = asRecord(seller?.commertialOffer);
  const price =
    typeof offer?.Price === "number" && offer.Price > 0
      ? offer.Price
      : typeof offer?.price === "number" && offer.price > 0
        ? offer.price
        : null;
  const specs = Array.isArray(product.specifications)
    ? product.specifications
    : Array.isArray(product.Specifications)
      ? product.Specifications
      : [];
  const attrs: string[] = [];
  for (const spec of specs) {
    const record = asRecord(spec);
    const name = text(record?.Name) ?? text(record?.name);
    const values = record?.Value ?? record?.values;
    const value = Array.isArray(values) ? text(values[0]) : text(values);
    if (name && value) attrs.push(`${name}: ${value}`);
  }
  const name = text(product.productName) ?? text(product.productTitle);
  return {
    ...emptyShopperOffer(),
    pageUrl,
    name,
    seller: text(seller?.sellerName),
    imageUrl: httpsProductImageUrl(text(image?.imageUrl), pageUrl),
    price,
    currency: "BRL",
    rating: null,
    shipping: null,
    guarantee:
      attrs.find((attr) => /garantia|warranty/i.test(attr))?.replace(/^[^:]+:\s*/, "") ?? null,
    dose:
      attrs.find((attr) => /dose|capsula|nutriente/i.test(attr))?.replace(/^[^:]+:\s*/, "") ?? null,
    quality:
      attrs.find((attr) => /anvisa|nsf|certif/i.test(attr))?.replace(/^[^:]+:\s*/, "") ?? null,
    attrs: attrs.slice(0, 16),
  };
}

async function readJson(url: string, fetchImpl: typeof fetch): Promise<unknown | null> {
  try {
    const res = await fetchImpl(url, {
      method: "GET",
      redirect: "follow",
      signal: AbortSignal.timeout(OFFER_FETCH_TIMEOUT_MS),
      headers: offerJsonHeaders(),
    });
    if (!res.ok) return null;
    return await res.json();
  } catch {
    return null;
  }
}

export const mercadoLivreReader: OfferReader = {
  id: "mercado_livre",
  canRead: (url) => Boolean(mercadoLivreItemId(url)),
  read: async (url, fetchImpl = fetch) => {
    const id = mercadoLivreItemId(url);
    if (!id) return emptyShopperOffer();
    const itemRaw = await readJson(`https://api.mercadolivre.com/items/${id}`, fetchImpl);
    const item = asRecord(itemRaw);
    if (!item) return emptyShopperOffer();
    const reviewsRaw = await readJson(`https://api.mercadolivre.com/reviews/item/${id}`, fetchImpl);
    return shopperOfferFromMercadoLivreItem(item, asRecord(reviewsRaw), url);
  },
};

export const vtexReader: OfferReader = {
  id: "vtex",
  canRead: (url) => Boolean(vtexSearchUrl(url)),
  read: async (url, fetchImpl = fetch) => {
    const search = vtexSearchUrl(url);
    if (!search) return emptyShopperOffer();
    const payload = await readJson(search, fetchImpl);
    return shopperOfferFromVtexSearch(payload, url) ?? emptyShopperOffer();
  },
};
