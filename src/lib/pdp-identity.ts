const FETCH_TIMEOUT_MS = 8_000;
/** Browser-like UA — some storefronts strip JSON-LD for unknown bots. */
const USER_AGENT =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36";

/**
 * Identity from a public PDP GET. Not Shopify-specific — any store with JSON-LD Product
 * and/or Open Graph.
 *
 * `hasJsonLd`:
 * - `true` — Product (or ProductGroup) structured data found
 * - `false` — HTML readable, no Product structured data
 * - `null` — could not verify (fetch failed, password wall, challenge)
 */
export type PublicPdpIdentity = {
  name: string | null;
  brand: string | null;
  currentPrice: number;
  currency: string | null;
  attributes: string[];
  material: string | null;
  color: string | null;
  dimension: string | null;
  image: string | null;
  imageSource: "json_ld" | "og" | null;
  hasJsonLd: boolean | null;
  hasOg: boolean;
};

/** What a public GET actually reached — Admin catalog is not the storefront. */
export type StorefrontAccess = "open" | "password" | "blocked" | "unverified";

export type PublicPdpFetch = {
  url: string;
  alive: boolean;
  status: number | null;
  html: string | null;
  /** Password wall, bot challenge, or empty shell — do not treat as “schema absent”. */
  blocked: boolean;
  storefrontAccess: StorefrontAccess;
  identity: PublicPdpIdentity;
};

function emptyIdentity(hasJsonLd: boolean | null = null): PublicPdpIdentity {
  return {
    name: null,
    brand: null,
    currentPrice: 0,
    currency: null,
    attributes: [],
    material: null,
    color: null,
    dimension: null,
    image: null,
    imageSource: null,
    hasJsonLd,
    hasOg: false,
  };
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function typeList(value: unknown): string[] {
  if (typeof value === "string") return [value];
  if (Array.isArray(value)) return value.filter((item): item is string => typeof item === "string");
  return [];
}

/** "https://schema.org/Product" → "product"; "schema:Product" → "product". */
function normalizeSchemaType(type: string): string {
  const cleaned = type.trim().toLowerCase();
  const withoutScheme = cleaned.includes("://")
    ? cleaned.slice(cleaned.lastIndexOf("/") + 1)
    : cleaned;
  return withoutScheme.replace(/^schema:/, "");
}

function isProductLikeType(type: string): boolean {
  const leaf = normalizeSchemaType(type);
  return (
    leaf === "product" ||
    leaf === "productmodel" ||
    leaf === "individualproduct" ||
    leaf === "productgroup"
  );
}

function isProductNode(node: Record<string, unknown>): boolean {
  return typeList(node["@type"]).some(isProductLikeType);
}

function firstVariantProduct(node: Record<string, unknown>): Record<string, unknown> | null {
  const variants = node.hasVariant ?? node.variesBy ?? node.model;
  const list = Array.isArray(variants) ? variants : variants ? [variants] : [];
  for (const item of list) {
    const record = asRecord(item);
    if (!record) continue;
    if (
      isProductNode(record) &&
      normalizeSchemaType(typeList(record["@type"])[0] ?? "") !== "productgroup"
    ) {
      return record;
    }
    if (textValue(record.name) || record.offers || record.image) return record;
  }
  return null;
}

function collectNodes(value: unknown, into: Record<string, unknown>[]): void {
  if (Array.isArray(value)) {
    for (const item of value) collectNodes(item, into);
    return;
  }
  const record = asRecord(value);
  if (!record) return;
  into.push(record);
  if (record["@graph"]) collectNodes(record["@graph"], into);
  // ItemList / OfferCatalog often wrap Product nodes.
  if (record.itemListElement) collectNodes(record.itemListElement, into);
  if (record.hasPart) collectNodes(record.hasPart, into);
  if (record.mainEntity) collectNodes(record.mainEntity, into);
  if (record.item) collectNodes(record.item, into);
}

function textValue(value: unknown): string | null {
  if (typeof value === "string" && value.trim()) return value.trim();
  const record = asRecord(value);
  if (record && typeof record.name === "string" && record.name.trim()) return record.name.trim();
  return null;
}

function decodeEntities(value: string): string {
  return value
    .replace(/&amp;/g, "&")
    .replace(/&quot;/g, '"')
    .replace(/&#39;|&apos;/g, "'")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">");
}

function numberValue(value: unknown): number {
  if (typeof value === "number" && Number.isFinite(value) && value > 0) return value;
  if (typeof value !== "string") return 0;
  const digits = decodeEntities(value)
    .trim()
    .replace(/[^\d.,-]/g, "");
  if (!digits) return 0;
  const lastComma = digits.lastIndexOf(",");
  const lastDot = digits.lastIndexOf(".");
  const normalized =
    lastComma > lastDot
      ? digits.replace(/\./g, "").replace(",", ".")
      : lastDot > lastComma
        ? digits.replace(/,/g, "")
        : digits;
  const parsed = Number(normalized);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : 0;
}

function offerPrice(offers: unknown): { price: number; currency: string | null } {
  const list = Array.isArray(offers) ? offers : [offers];
  for (const offer of list) {
    const record = asRecord(offer);
    if (!record) continue;
    const spec = asRecord(record.priceSpecification);
    const price = numberValue(record.price ?? record.lowPrice ?? spec?.price);
    if (price > 0) {
      const currency =
        (typeof record.priceCurrency === "string" && record.priceCurrency) ||
        (typeof spec?.priceCurrency === "string" && spec.priceCurrency) ||
        null;
      return { price, currency };
    }
  }
  return { price: 0, currency: null };
}

function quantitativeText(value: unknown): string | null {
  const direct = textValue(value);
  if (direct) return direct;
  const record = asRecord(value);
  if (!record) return null;
  const amount =
    textValue(record.value) ??
    (typeof record.value === "number" && Number.isFinite(record.value)
      ? String(record.value)
      : null);
  const unit = textValue(record.unitText) ?? textValue(record.unitCode);
  if (amount && unit) return `${amount} ${unit}`;
  return amount;
}

function absolutizeHttpUrl(raw: string, baseUrl: string | null): string | null {
  const href = raw.trim();
  if (!href) return null;
  try {
    const resolved = baseUrl ? new URL(href, baseUrl) : new URL(href);
    if (!["http:", "https:"].includes(resolved.protocol)) return null;
    if (!resolved.hostname?.includes(".")) return null;
    return resolved.href;
  } catch {
    return null;
  }
}

function imageUrl(value: unknown, baseUrl: string | null): string | null {
  if (typeof value === "string") {
    return absolutizeHttpUrl(value, baseUrl);
  }
  if (Array.isArray(value)) {
    for (const item of value) {
      const found = imageUrl(item, baseUrl);
      if (found) return found;
    }
    return null;
  }
  const record = asRecord(value);
  if (!record) return null;
  return imageUrl(record.url, baseUrl) ?? imageUrl(record.contentUrl, baseUrl);
}

function jsonLdAttributes(node: Record<string, unknown>): string[] {
  const attrs: string[] = [];
  const extra = node.additionalProperty;
  const list = Array.isArray(extra) ? extra : extra ? [extra] : [];
  for (const item of list) {
    const record = asRecord(item);
    if (!record) continue;
    const name = textValue(record.name);
    const value = textValue(record.value) ?? quantitativeText(record.value);
    if (name && value) attrs.push(`${name}: ${value}`);
    else if (name) attrs.push(name);
    else if (value) attrs.push(value);
  }
  for (const key of [
    "material",
    "color",
    "colour",
    "size",
    "pattern",
    "sku",
    "model",
    "category",
    "width",
    "height",
    "depth",
    "weight",
  ] as const) {
    const values = Array.isArray(node[key]) ? node[key] : [node[key]];
    for (const item of values) {
      const value = quantitativeText(item) ?? textValue(item);
      if (value) attrs.push(key === "colour" ? value : key === "sku" ? `SKU: ${value}` : value);
    }
  }
  return [...new Set(attrs)].slice(0, 12);
}

function factFromAttributes(attributes: string[], needles: string[]): string | null {
  for (const attribute of attributes) {
    const sep = attribute.indexOf(":");
    if (sep < 0) continue;
    const name = attribute.slice(0, sep).trim().toLowerCase();
    const value = attribute.slice(sep + 1).trim();
    if (value && needles.includes(name)) return value;
  }
  return null;
}

/** Storefronts sometimes emit two JSON objects back-to-back inside one script. */
function splitJsonDocuments(raw: string): string[] {
  const trimmed = raw.trim();
  if (!trimmed) return [];
  const docs: string[] = [];
  let depth = 0;
  let start = -1;
  let inString = false;
  let escaping = false;
  for (let i = 0; i < trimmed.length; i++) {
    const ch = trimmed.charAt(i);
    if (inString) {
      if (escaping) escaping = false;
      else if (ch === "\\") escaping = true;
      else if (ch === '"') inString = false;
      continue;
    }
    if (ch === '"') {
      inString = true;
      continue;
    }
    if (ch === "{") {
      if (depth === 0) start = i;
      depth++;
    } else if (ch === "}") {
      depth--;
      if (depth === 0 && start >= 0) {
        docs.push(trimmed.slice(start, i + 1));
        start = -1;
      }
    }
  }
  return docs.length > 0 ? docs : [trimmed];
}

function parseJsonLdPayload(raw: string): unknown | null {
  const unescaped = decodeEntities(raw)
    .replace(/^\uFEFF/, "")
    .trim();
  if (!unescaped) return null;

  const tryParse = (text: string): unknown | null => {
    try {
      return JSON.parse(text);
    } catch {
      try {
        return JSON.parse(text.replace(/,\s*([}\]])/g, "$1"));
      } catch {
        return null;
      }
    }
  };

  const direct = tryParse(unescaped);
  if (direct != null) return direct;

  const docs = splitJsonDocuments(unescaped)
    .map(tryParse)
    .filter((doc): doc is unknown => doc != null);
  if (docs.length === 1) return docs[0];
  if (docs.length > 1) return docs;
  return null;
}

function firstProduct(html: string): Record<string, unknown> | null {
  const scripts = html.matchAll(
    /<script[^>]*type\s*=\s*["']?application\/ld\+json["']?[^>]*>([\s\S]*?)<\/script>/gi,
  );
  const products: Record<string, unknown>[] = [];
  const groups: Record<string, unknown>[] = [];

  for (const match of scripts) {
    const raw = match[1]
      ?.trim()
      .replace(/^<!--\s*/, "")
      .replace(/\s*-->$/, "")
      .replace(/^<!\[CDATA\[\s*/i, "")
      .replace(/\s*\]\]>$/i, "")
      .trim();
    if (!raw) continue;
    const parsed = parseJsonLdPayload(raw);
    if (parsed == null) continue;
    const nodes: Record<string, unknown>[] = [];
    collectNodes(parsed, nodes);
    for (const node of nodes) {
      const types = typeList(node["@type"]).map(normalizeSchemaType);
      if (types.includes("productgroup")) groups.push(node);
      else if (
        types.some(
          (type) => type === "product" || type === "productmodel" || type === "individualproduct",
        )
      ) {
        products.push(node);
      } else if (isProductNode(node)) {
        products.push(node);
      }
    }
  }

  if (products[0]) return products[0];
  for (const group of groups) {
    const nested = firstVariantProduct(group);
    if (nested) return nested;
    // ProductGroup itself still counts as structured product data for hasJsonLd.
    return group;
  }
  return null;
}

/** Microdata Product counts as structured data AI crawlers can read. */
function hasProductMicrodata(html: string): boolean {
  return /itemtype\s*=\s*["'][^"']*schema\.org\/Product\b/i.test(html);
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
  return decodeEntities(html.match(re)?.[1]?.trim() || html.match(alt)?.[1]?.trim() || "") || null;
}

function tagText(html: string, tag: string): string | null {
  const match = html.match(new RegExp(`<${tag}[^>]*>([^<]+)</${tag}>`, "i"));
  const text = match?.[1]?.replace(/\s+/g, " ").trim();
  return text || null;
}

/** Password wall on any storefront — public and AI crawlers cannot open the URL. */
export function isPasswordStorefrontHtml(html: string, finalUrl: string): boolean {
  try {
    const path = new URL(finalUrl).pathname.toLowerCase();
    if (path === "/password" || path.startsWith("/password/")) return true;
  } catch {
    /* ignore */
  }
  const sample = html.slice(0, 8_000).toLowerCase();
  if (sample.includes("password-protected") || sample.includes("storefront_password")) return true;
  if (sample.includes("this shop is password") || sample.includes("store is password protected")) {
    return true;
  }
  if (sample.includes("loja protegida por senha")) return true;
  return sample.includes('name="password"') && sample.includes("/password");
}

export function classifyStorefrontAccess(input: {
  alive: boolean;
  status?: number | null;
  html: string | null;
  finalUrl: string;
}): StorefrontAccess {
  if (input.status === 401 || input.status === 403) return "blocked";
  if (!input.alive || !input.html) return "unverified";
  if (isPasswordStorefrontHtml(input.html, input.finalUrl)) return "password";
  if (isBlockedStorefrontHtml(input.html, input.finalUrl)) return "blocked";
  return "open";
}

/**
 * Password walls / bot challenges look “alive” (HTTP 200) but are not the PDP.
 * Claiming JSON-LD absent here is a false negative.
 */
export function isBlockedStorefrontHtml(html: string, finalUrl: string): boolean {
  try {
    const path = new URL(finalUrl).pathname.toLowerCase();
    if (path.includes("/challenge")) return true;
  } catch {
    /* ignore */
  }
  if (isPasswordStorefrontHtml(html, finalUrl)) return true;
  const sample = html.slice(0, 8_000).toLowerCase();
  if (sample.includes("cf-browser-verification") || sample.includes("cf-challenge")) return true;
  if (sample.includes("attention required") && sample.includes("cloudflare")) return true;
  // Empty / tiny shells after redirects are not verifiable PDPs.
  if (html.trim().length < 400 && !/<script[\s>]/i.test(html)) return true;
  return false;
}

/** Floor identity from a public PDP GET. Platform-agnostic: JSON-LD Product, then Open Graph. */
export function parsePublicPdpHtml(html: string, baseUrl: string | null = null): PublicPdpIdentity {
  const identity = emptyIdentity(false);
  const product = firstProduct(html);
  if (product) {
    identity.hasJsonLd = true;
    identity.name = textValue(product.name);
    identity.brand = textValue(product.brand) ?? textValue(product.manufacturer);
    const offer = offerPrice(product.offers);
    identity.currentPrice = offer.price;
    identity.currency = offer.currency;
    identity.attributes = jsonLdAttributes(product);
    identity.material = textValue(product.material);
    identity.color = textValue(product.color) ?? textValue(product.colour);
    identity.dimension =
      quantitativeText(product.width) ??
      quantitativeText(product.height) ??
      quantitativeText(product.depth) ??
      factFromAttributes(identity.attributes, [
        "largura",
        "altura",
        "profundidade",
        "width",
        "height",
        "depth",
      ]);
    identity.image = imageUrl(product.image, baseUrl);
    if (identity.image) identity.imageSource = "json_ld";
  } else if (hasProductMicrodata(html)) {
    identity.hasJsonLd = true;
  }

  const ogTitle = metaContent(html, "og:title");
  const ogBrand = metaContent(html, "product:brand") ?? metaContent(html, "og:brand");
  const ogPrice = metaContent(html, "product:price:amount") ?? metaContent(html, "og:price:amount");
  const ogCurrency =
    metaContent(html, "product:price:currency") ?? metaContent(html, "og:price:currency");
  const ogImage = metaContent(html, "og:image:secure_url") ?? metaContent(html, "og:image");
  const ogCategory = metaContent(html, "product:category") ?? metaContent(html, "og:category");
  const ogCondition = metaContent(html, "product:condition");
  if (ogTitle || ogBrand || ogPrice || ogCurrency || ogImage || ogCategory) identity.hasOg = true;
  if (!identity.name && ogTitle) identity.name = ogTitle;
  if (!identity.brand && ogBrand) identity.brand = ogBrand;
  if (!(identity.currentPrice > 0) && ogPrice) identity.currentPrice = numberValue(ogPrice);
  if (!identity.currency && ogCurrency) identity.currency = ogCurrency;
  if (!identity.image && ogImage) {
    const resolved = absolutizeHttpUrl(ogImage, baseUrl);
    if (resolved) {
      identity.image = resolved;
      identity.imageSource = "og";
    }
  }
  if (ogCategory)
    identity.attributes = [...new Set([...identity.attributes, ogCategory])].slice(0, 12);
  if (ogCondition)
    identity.attributes = [...new Set([...identity.attributes, ogCondition])].slice(0, 12);
  if (!identity.material) {
    identity.material = factFromAttributes(identity.attributes, ["material", "tecido", "malha"]);
  }
  if (!identity.color) {
    identity.color = factFromAttributes(identity.attributes, ["color", "colour", "cor"]);
  }
  if (!identity.dimension) {
    identity.dimension = factFromAttributes(identity.attributes, [
      "largura",
      "altura",
      "profundidade",
      "width",
      "height",
      "depth",
    ]);
  }

  if (!identity.name) {
    identity.name = tagText(html, "title") ?? tagText(html, "h1");
  }

  return identity;
}

function withStorefrontAccess(row: Omit<PublicPdpFetch, "storefrontAccess">): PublicPdpFetch {
  return {
    ...row,
    storefrontAccess: classifyStorefrontAccess({
      alive: row.alive,
      status: row.status,
      html: row.html,
      finalUrl: row.url,
    }),
  };
}

/** Commerce host the public PDP sits on. Null when we cannot tell — never invent. */
export type StorefrontPlatform = "shopify" | "vtex" | "nuvemshop";

function hostnameOf(url: string): string | null {
  try {
    return new URL(url).hostname.toLowerCase().replace(/^www\./, "");
  } catch {
    return null;
  }
}

function platformFromHostname(host: string): StorefrontPlatform | null {
  if (host === "myshopify.com" || host.endsWith(".myshopify.com")) return "shopify";
  if (
    host === "myvtex.com" ||
    host.endsWith(".myvtex.com") ||
    host.endsWith(".vtexcommercestable.com.br") ||
    host.endsWith(".vtexlocal.com.br") ||
    host.endsWith(".vteximg.com.br") ||
    host.endsWith(".vtexassets.com")
  ) {
    return "vtex";
  }
  if (
    host.endsWith(".nuvemshop.com.br") ||
    host.endsWith(".nuvemshop.com") ||
    host.endsWith(".lojavirtualnuvem.com.br") ||
    host.endsWith(".mitiendanube.com")
  ) {
    return "nuvemshop";
  }
  return null;
}

function htmlPlatformVotes(html: string): Set<StorefrontPlatform> {
  const sample = html.slice(0, 80_000).toLowerCase();
  const votes = new Set<StorefrontPlatform>();
  if (
    sample.includes("cdn.shopify.com") ||
    sample.includes("shopify-section") ||
    sample.includes("shopify.theme") ||
    sample.includes("storefront_password") ||
    sample.includes("myshopify.com") ||
    /name=["']generator["'][^>]*content=["'][^"']*shopify/i.test(html) ||
    /content=["'][^"']*shopify["'][^>]*name=["']generator/i.test(html)
  ) {
    votes.add("shopify");
  }
  if (
    sample.includes("vtexassets.com") ||
    sample.includes("io.vtex.com.br") ||
    sample.includes("vteximg.com.br") ||
    sample.includes("vtexcommercestable") ||
    sample.includes("vtex-render") ||
    sample.includes("/arquivos/ids/") ||
    /name=["']generator["'][^>]*content=["'][^"']*vtex/i.test(html) ||
    /content=["'][^"']*vtex["'][^>]*name=["']generator/i.test(html)
  ) {
    votes.add("vtex");
  }
  if (
    sample.includes("nuvemshop") ||
    sample.includes("tiendanube") ||
    sample.includes("lojavirtualnuvem") ||
    sample.includes("mitiendanube") ||
    sample.includes("nimbus-cdn")
  ) {
    votes.add("nuvemshop");
  }
  return votes;
}

/**
 * Layered storefront host: URL host, then JSON-LD / schema / HTML fingerprints.
 * Password walls rarely expose Product JSON-LD; host + password-page marks still count.
 */
export function detectStorefrontPlatform(input: {
  url: string;
  html?: string | null;
}): StorefrontPlatform | null {
  const host = hostnameOf(input.url);
  const fromHost = host ? platformFromHostname(host) : null;
  const html = input.html?.trim() ? input.html : "";
  const votes = html ? htmlPlatformVotes(html) : new Set<StorefrontPlatform>();

  if (fromHost) return fromHost;
  if (votes.size === 1) return [...votes][0] ?? null;
  return null;
}

export async function fetchPublicPdp(url: string): Promise<PublicPdpFetch> {
  try {
    const parsed = new URL(url);
    if (!["http:", "https:"].includes(parsed.protocol)) {
      return withStorefrontAccess({
        url,
        alive: false,
        status: null,
        html: null,
        blocked: false,
        identity: emptyIdentity(null),
      });
    }

    const res = await fetch(url, {
      method: "GET",
      redirect: "follow",
      signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
      headers: {
        Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
        "Accept-Language": "pt-BR,pt;q=0.9,en-US;q=0.8,en;q=0.7",
        "User-Agent": USER_AGENT,
        "Cache-Control": "no-cache",
      },
    });
    const alive = res.status >= 200 && res.status < 400;
    const html = alive ? await res.text() : null;
    const finalUrl = res.url || url;
    if (!html) {
      return withStorefrontAccess({
        url: finalUrl,
        alive,
        status: res.status,
        html: null,
        blocked: false,
        identity: emptyIdentity(null),
      });
    }

    const blocked = isBlockedStorefrontHtml(html, finalUrl);
    if (blocked) {
      return withStorefrontAccess({
        url: finalUrl,
        alive,
        status: res.status,
        html,
        blocked: true,
        identity: emptyIdentity(null),
      });
    }

    return withStorefrontAccess({
      url: finalUrl,
      alive,
      status: res.status,
      html,
      blocked: false,
      identity: parsePublicPdpHtml(html, finalUrl),
    });
  } catch {
    return withStorefrontAccess({
      url,
      alive: false,
      status: null,
      html: null,
      blocked: false,
      identity: emptyIdentity(null),
    });
  }
}
