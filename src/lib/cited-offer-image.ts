/** Layered product photo for a cited competitor. Pontual GET of URLs Gemini already named — not a catalog. */

import { productIdentityKey, type CitedObjectLike } from "./cited-offer.js";
import {
  fetchPublicPdp,
  parsePublicPdpHtml,
  type PublicPdpIdentity,
} from "./pdp-identity.js";
import { hydrateGeminiStructured, type GeminiStructuredOutput } from "./llm/gemini-structured.js";

export type CitedImageLayer = "gemini" | "json_ld" | "og" | "twitter" | "grounding";

export type CitedImageHit = {
  url: string;
  layer: CitedImageLayer;
};

const GROUNDING_FETCH_CAP = 2;

function httpsImageUrl(raw: string | null | undefined, baseUrl?: string | null): string | null {
  const href = raw?.trim() ?? "";
  if (!href) return null;
  try {
    const url = baseUrl ? new URL(href, baseUrl) : new URL(href);
    if (url.protocol === "http:") url.protocol = "https:";
    if (url.protocol !== "https:") return null;
    if (!url.hostname?.includes(".")) return null;
    return url.href;
  } catch {
    return null;
  }
}

function metaContent(html: string, property: string): string | null {
  const escaped = property.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const re = new RegExp(
    `<meta[^>]+(?:property|name)=["']${escaped}["'][^>]+content=["']([^"']+)["']`,
    "i",
  );
  const alt = new RegExp(
    `<meta[^>]+content=["']([^"']+)["'][^>]+(?:property|name)=["']${escaped}["']`,
    "i",
  );
  return html.match(re)?.[1]?.trim() || html.match(alt)?.[1]?.trim() || null;
}

function fromIdentity(identity: PublicPdpIdentity): CitedImageHit | null {
  const url = httpsImageUrl(identity.image);
  if (!url) return null;
  if (identity.imageSource === "json_ld") return { url, layer: "json_ld" };
  return { url, layer: "og" };
}

/** JSON-LD Product.image → og:image → twitter:image. No invented path. */
export function pickCitedImageFromHtml(html: string, baseUrl: string): CitedImageHit | null {
  const identity = parsePublicPdpHtml(html, baseUrl);
  const structured = fromIdentity(identity);
  if (structured) return structured;
  const twitter =
    httpsImageUrl(metaContent(html, "twitter:image"), baseUrl) ??
    httpsImageUrl(metaContent(html, "twitter:image:src"), baseUrl);
  return twitter ? { url: twitter, layer: "twitter" } : null;
}

async function fetchPageImage(
  url: string,
  layerIfHit: CitedImageLayer,
): Promise<CitedImageHit | null> {
  const page = await fetchPublicPdp(url);
  if (!page.alive || page.blocked || !page.html) return null;
  const hit = pickCitedImageFromHtml(page.html, page.url || url);
  if (!hit) return null;
  if (layerIfHit === "grounding" && (hit.layer === "og" || hit.layer === "twitter" || hit.layer === "json_ld")) {
    return { url: hit.url, layer: "grounding" };
  }
  return hit;
}

/**
 * 1. Gemini `imagem_url` if it is an https image.
 * 2. Cited product URL: JSON-LD → Open Graph → Twitter.
 * 3. Grounding pages Gemini already opened (reviews), cap 2.
 */
export async function resolveCitedOfferImage(input: {
  imagemUrl?: string | null;
  productUrl?: string | null;
  groundingUrls?: string[] | null;
}): Promise<CitedImageHit | null> {
  const gemini = httpsImageUrl(input.imagemUrl);
  if (gemini) return { url: gemini, layer: "gemini" };

  const productUrl = input.productUrl?.trim() || "";
  if (productUrl) {
    const fromProduct = await fetchPageImage(productUrl, "json_ld");
    if (fromProduct) return fromProduct;
  }

  const seen = new Set<string>();
  let used = 0;
  for (const raw of input.groundingUrls ?? []) {
    if (used >= GROUNDING_FETCH_CAP) break;
    const href = raw.trim();
    if (!href || href === productUrl) continue;
    try {
      const host = new URL(href).hostname.replace(/^www\./, "").toLowerCase();
      if (!host || seen.has(host)) continue;
      seen.add(host);
    } catch {
      continue;
    }
    used += 1;
    const fromGrounding = await fetchPageImage(href, "grounding");
    if (fromGrounding) return fromGrounding;
  }
  return null;
}

export function stampCitedImage<T extends CitedObjectLike>(
  objects: T[],
  productKey: string,
  url: string,
): T[] {
  return objects.map((object) => {
    if (productIdentityKey(object) !== productKey) return object;
    if (object.imagem_url?.trim()) return object;
    return { ...object, imagem_url: url };
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
