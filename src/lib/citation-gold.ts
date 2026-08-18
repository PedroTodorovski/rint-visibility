export type CitationGoldWhy =
  | "grounding_host"
  | "negative_mention"
  | "text_only_not_grounded"
  | "no_client_signal";

export type ResolvedGroundingUrl = {
  from: string;
  to: string | null;
  host: string | null;
  /** Gemini `web.title` — search-result title, not an H1 we fetched. */
  title?: string | null;
};

export type ClientIdentity = {
  storeName: string;
  domain: string | null;
  productUrl: string;
  productName: string;
};

export type ClientCitationEvidence = {
  cited: boolean;
  why: CitationGoldWhy;
  llm_claimed_cited: boolean;
  negative_mention: boolean;
  prompt: "blind_shopper";
  client_hosts: string[];
  grounding_hosts: string[];
  resolved: ResolvedGroundingUrl[];
};

export type OwnedSurfaceKind =
  | "owned_storefront"
  | "owned_content_directory"
  | "owned_content_subdomain"
  | "external_source";

export type SearchConsoleProperty =
  | { type: "domain"; domain: string }
  | { type: "url_prefix"; url: string };

export type SearchConsoleOwnedContentCandidate = {
  url: string;
  property: string;
  clicks: number | null;
  impressions: number | null;
  ctr?: number | null;
  position?: number | null;
  topQuery: string | null;
  queries?: Array<{
    query: string;
    clicks: number | null;
    impressions: number | null;
    ctr?: number | null;
    position?: number | null;
  }>;
};

export type BrandSurfaceConfig = {
  storefrontHosts: string[];
  productUrls?: string[];
  ownedContentHosts?: string[];
  ownedContentPaths?: string[];
  searchConsoleProperties?: SearchConsoleProperty[];
};

export type ClassifiedBrandSurface = {
  href: string;
  host: string | null;
  path: string;
  kind: OwnedSurfaceKind;
  search_console_coverage: "covered" | "not_covered" | "unknown";
};

const NEGATIVE_MENTION =
  /não\s+(?:foi\s+)?encontrad[oa]s?|não\s+aparece|não\s+encontrei|não\s+localizad|not\s+found|could\s+not\s+find|wasn't\s+found|were\s+not\s+found/i;

const DEFAULT_CONTENT_PATHS = [
  "/blog",
  "/blogs",
  "/pages",
  "/guias",
  "/guides",
  "/conteudo",
  "/conteudos",
  "/learn",
  "/resources",
];

/** Shopify Admin host — token only, never the shopper storefront. */
export function isShopifyAdminHost(host: string): boolean {
  const needle = normalizeHost(host);
  return needle === "myshopify.com" || (needle?.endsWith(".myshopify.com") ?? false);
}

export function normalizeHost(value: string): string | null {
  const raw = value
    .trim()
    .toLowerCase()
    .replace(/^https?:\/\//, "")
    .replace(/^www\./, "");
  const host = raw.split("/")[0]?.split(":")[0]?.trim() ?? "";
  if (!host || host === "unknown") return null;
  return host;
}

function urlParts(raw: string): { href: string; host: string | null; path: string } {
  try {
    const parsed = new URL(raw.trim());
    return {
      href: parsed.href,
      host: normalizeHost(parsed.hostname),
      path: parsed.pathname || "/",
    };
  } catch {
    const host = normalizeHost(raw);
    return { href: raw.trim(), host, path: "/" };
  }
}

function normalizedPath(path: string): string {
  const clean = path.trim() || "/";
  return clean.startsWith("/") ? clean.replace(/\/+$/, "") || "/" : `/${clean}`;
}

function isProductPath(path: string): boolean {
  return /^\/(products?|produto|p)\b/i.test(normalizedPath(path));
}

function pathStartsWith(path: string, prefixes: string[]): boolean {
  const current = normalizedPath(path).toLowerCase();
  return prefixes
    .map((prefix) => normalizedPath(prefix).toLowerCase())
    .some((prefix) => current === prefix || current.startsWith(`${prefix}/`));
}

function hostIsContentSubdomain(host: string, storefrontHosts: string[]): boolean {
  return storefrontHosts.some((storefront) => host === `blog.${storefront}`);
}

function sameUrlPath(left: string, right: string): boolean {
  try {
    const a = new URL(left);
    const b = new URL(right);
    return (
      normalizeHost(a.hostname) === normalizeHost(b.hostname) &&
      normalizedPath(a.pathname) === normalizedPath(b.pathname)
    );
  } catch {
    return false;
  }
}

function searchConsoleCoversUrl(
  href: string,
  host: string | null,
  properties: SearchConsoleProperty[] | undefined,
): "covered" | "not_covered" | "unknown" {
  if (!properties || properties.length === 0) return "unknown";
  if (!host) return "not_covered";
  for (const property of properties) {
    if (property.type === "domain") {
      const domain = normalizeHost(property.domain);
      if (domain && (host === domain || host.endsWith(`.${domain}`))) return "covered";
      continue;
    }
    try {
      const prefix = new URL(property.url.trim()).href;
      if (href.startsWith(prefix)) return "covered";
    } catch {}
  }
  return "not_covered";
}

export function classifyBrandSurface(
  rawUrl: string,
  config: BrandSurfaceConfig,
): ClassifiedBrandSurface {
  const parts = urlParts(rawUrl);
  const storefrontHosts = config.storefrontHosts
    .map(normalizeHost)
    .filter((host): host is string => Boolean(host));
  const contentHosts =
    config.ownedContentHosts?.map(normalizeHost).filter((host): host is string => Boolean(host)) ??
    [];
  const contentPaths = config.ownedContentPaths?.length
    ? config.ownedContentPaths
    : DEFAULT_CONTENT_PATHS;
  const host = parts.host;
  const coverage = searchConsoleCoversUrl(parts.href, host, config.searchConsoleProperties);
  let kind: OwnedSurfaceKind = "external_source";

  if (host) {
    const isStorefrontHost = storefrontHosts.includes(host);
    const productMatch = (config.productUrls ?? []).some((productUrl) =>
      sameUrlPath(productUrl, parts.href),
    );
    if (isStorefrontHost && (productMatch || isProductPath(parts.path))) {
      kind = "owned_storefront";
    } else if (isStorefrontHost && pathStartsWith(parts.path, contentPaths)) {
      kind = "owned_content_directory";
    } else if (
      contentHosts.includes(host) ||
      (hostIsContentSubdomain(host, storefrontHosts) && coverage === "covered")
    ) {
      kind = "owned_content_subdomain";
    }
  }

  return {
    href: parts.href,
    host,
    path: normalizedPath(parts.path),
    kind,
    search_console_coverage: coverage,
  };
}

export function clientHostsFromIdentity(identity: ClientIdentity): string[] {
  const hosts = new Set<string>();
  const domain = identity.domain ? normalizeHost(identity.domain) : null;
  if (domain && !isShopifyAdminHost(domain)) hosts.add(domain);
  try {
    const productHost = normalizeHost(new URL(identity.productUrl).hostname);
    if (productHost && !isShopifyAdminHost(productHost)) hosts.add(productHost);
  } catch {
    /* ignore invalid PDP */
  }
  return [...hosts];
}

export function hostMatchesClient(host: string, clientHosts: string[]): boolean {
  const needle = normalizeHost(host);
  if (!needle) return false;
  return clientHosts.some(
    (client) => needle === client || needle.endsWith(`.${client}`) || client.endsWith(`.${needle}`),
  );
}

/** Shopper storefront only — a blog/help subdomain is not a buy link. */
export function hostIsClientStorefront(host: string, clientHosts: string[]): boolean {
  const needle = normalizeHost(host);
  if (!needle) return false;
  return clientHosts.some((client) => needle === client);
}

function identityNeedles(identity: ClientIdentity): string[] {
  return [identity.storeName, identity.productName, identity.domain, identity.productUrl]
    .map((value) => value?.trim() ?? "")
    .filter((value) => value.length >= 3 && !isShopifyAdminHost(value));
}

export function hasNegativeClientMention(text: string, identity: ClientIdentity): boolean {
  const haystack = text.trim();
  if (!haystack || !NEGATIVE_MENTION.test(haystack)) return false;
  const lower = haystack.toLowerCase();
  return identityNeedles(identity).some((needle) => lower.includes(needle.toLowerCase()));
}

export function hasClientTextMention(text: string, identity: ClientIdentity): boolean {
  const lower = text.toLowerCase();
  return identityNeedles(identity).some((needle) => lower.includes(needle.toLowerCase()));
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/** Brand or store name as a word — not a generic product title like "Vitamina D3K2". */
export function textNamesClientBrand(text: string, storeName: string): boolean {
  const brand = storeName.trim();
  if (brand.length < 3 || !text.trim()) return false;
  return new RegExp(`(^|[^\\p{L}\\p{N}])${escapeRegExp(brand)}([^\\p{L}\\p{N}]|$)`, "iu").test(
    text,
  );
}

export function textNamesClientStoreLink(
  text: string,
  identity: Pick<ClientIdentity, "domain" | "productUrl">,
): boolean {
  const lower = text.toLowerCase();
  const hosts = clientHostsFromIdentity({
    storeName: "",
    domain: identity.domain,
    productUrl: identity.productUrl,
    productName: "",
  });
  return hosts.some((host) => host.length > 0 && lower.includes(host));
}

/** Brand in the answer, no buy link in the text and no client host in grounding. */
export function brandMentionedWithoutBuyLink(input: {
  text: string;
  storeName: string;
  domain: string | null;
  productUrl: string;
  resolved: ResolvedGroundingUrl[];
}): boolean {
  if (!textNamesClientBrand(input.text, input.storeName)) return false;
  const identity: ClientIdentity = {
    storeName: input.storeName,
    domain: input.domain,
    productUrl: input.productUrl,
    productName: input.storeName,
  };
  const clientHosts = clientHostsFromIdentity(identity);
  const inGrounding = input.resolved.some(
    (row) => row.host != null && hostIsClientStorefront(row.host, clientHosts),
  );
  if (inGrounding) return false;
  if (textNamesClientStoreLink(input.text, identity)) return false;
  return true;
}

export function planClientSiteFollowUp(
  storeName: string,
  productName: string,
): {
  reason: "missing_client_site";
  query: string;
} {
  const named = storeName.trim() || productName.trim() || "essa marca";
  return {
    reason: "missing_client_site",
    query: `Você falou da ${named}. Em qual site o comprador encontra e compra? Qual o link da loja?`,
  };
}

export function scoreClientCitation(input: {
  text: string;
  identity: ClientIdentity;
  resolved: ResolvedGroundingUrl[];
  llmClaimedCited: boolean;
}): ClientCitationEvidence {
  const clientHosts = clientHostsFromIdentity(input.identity);
  const groundingHosts = [
    ...new Set(
      input.resolved.map((row) => row.host).filter((host): host is string => Boolean(host)),
    ),
  ];
  const clientInGrounding = groundingHosts.some((host) => hostMatchesClient(host, clientHosts));
  const negative = hasNegativeClientMention(input.text, input.identity);
  const textMention = hasClientTextMention(input.text, input.identity);

  let cited = false;
  let why: CitationGoldWhy = "no_client_signal";
  if (clientInGrounding) {
    cited = true;
    why = "grounding_host";
  } else if (negative) {
    why = "negative_mention";
  } else if (textMention) {
    why = "text_only_not_grounded";
  }

  return {
    cited,
    why,
    llm_claimed_cited: input.llmClaimedCited,
    negative_mention: negative,
    prompt: "blind_shopper",
    client_hosts: clientHosts,
    grounding_hosts: groundingHosts,
    resolved: input.resolved,
  };
}
