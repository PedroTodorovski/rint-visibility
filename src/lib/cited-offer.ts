/** Competitor SKU identity + crown view. Persist every cited object; crown does not delete. */

export type OfferConfidence = "clear" | "split" | "store_only" | "empty";

export type CitedObjectLike = {
  marca?: string | null;
  loja?: string | null;
  produto?: string | null;
  url?: string | null;
  preco?: number | null;
  moeda?: string | null;
  prazo_entrega?: string | null;
  avaliacao?: string | null;
  dimensoes?: string | null;
  qualidade?: string | null;
  imagem_url?: string | null;
  atributos?: string[] | null;
  /**
   * Engine-computed per-object grounding verdict (`grounding_confirmed_client` on
   * `GeminiCitedObject`, `src/lib/llm/gemini-structured.ts`, ADR-003) — takes precedence over
   * any per-query verdict when present. Absent on data persisted before this field existed, or
   * where this repo's helpers weren't threaded it through.
   */
  grounding_confirmed_client?: boolean;
};

export type ClientOfferIdentity = {
  name: string;
  brand: string | null;
  url?: string | null;
};

export type OfferCandidate = {
  productKey: string;
  marca: string | null;
  produto: string | null;
  count: number;
  seller: string | null;
};

export type CrownedOffer = {
  confidence: OfferConfidence;
  productKey: string | null;
  marca: string | null;
  produto: string | null;
  seller: string | null;
  sellerHost: string | null;
  url: string | null;
  preco: number | null;
  moeda: string | null;
  prazo_entrega: string | null;
  avaliacao: string | null;
  dimensoes: string | null;
  qualidade: string | null;
  imagem_url: string | null;
  atributos: string[];
  candidates: OfferCandidate[];
  storeHints: Array<{ loja: string; count: number }>;
  citingQueryCount: number;
  persistedCount: number;
};

export type CitedOfferFollowUpPlan = {
  query: string;
  reason: "missing_product" | "missing_seller" | "missing_facts";
};

export function foldIdentity(value: string | null | undefined): string {
  return (value ?? "")
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

/** Same as foldIdentity, but "Complete Bari" and "CompleteBari" are one name. */
export function compactIdentity(value: string | null | undefined): string {
  return foldIdentity(value).replace(/\s+/g, "");
}

/** Marca + produto without “Centrum Centrum Bariátrico”. Twin: rint-app. */
export function formatCitedOfferLabel(
  marca: string | null | undefined,
  produto: string | null | undefined,
): string {
  const brand = marca?.trim() ?? "";
  const product = produto?.trim() ?? "";
  if (!brand) return product;
  if (!product) return brand;
  const brandFold = foldIdentity(brand);
  const productFold = foldIdentity(product);
  if (productFold.startsWith(brandFold)) return product;
  if (brandFold.startsWith(productFold)) return brand;
  return `${brand} ${product}`;
}

export function hostFromUrl(url: string | null | undefined): string | null {
  if (!url) return null;
  const trimmed = url.trim();
  if (!trimmed) return null;
  const href = trimmed.includes("://")
    ? trimmed
    : /^[a-z0-9.-]+\.[a-z]{2,}(?:[:/?#]|$)/i.test(trimmed)
      ? `https://${trimmed}`
      : trimmed;
  try {
    const host = new URL(href).hostname.replace(/^www\./, "").toLowerCase();
    return host || null;
  } catch {
    return null;
  }
}

/** Category words that must not claim the client's Shopify title (ADR-003 residual). */
const GENERIC_CITED_IDENTITY = new Set([
  "multivitaminico",
  "polivitaminico",
  "vitamina",
  "vitaminas",
  "vitamin",
  "suplemento",
  "suplementos",
  "produto",
  "kit",
  "capsula",
  "capsulas",
]);

/**
 * Brand/product overlap without the first-word hole (`"Multivitamínico …" ⊂ client title`).
 * Twin: `rint-app/src/lib/cited-offer.ts`.
 */
export function citedNameAlignsWithClient(
  citedRaw: string | null | undefined,
  client: Pick<ClientOfferIdentity, "name" | "brand">,
): boolean {
  const cited = compactIdentity(citedRaw);
  if (cited.length < 3) return false;

  const brand = compactIdentity(client.brand);
  if (brand.length >= 3 && cited === brand) return true;
  if (brand.length >= 4 && cited.includes(brand)) return true;

  const product = compactIdentity(client.name);
  if (product.length < 3) return false;
  if (cited === product) return true;
  if (GENERIC_CITED_IDENTITY.has(cited)) return false;
  if (product.includes(cited) || cited.includes(product)) {
    const shorter = cited.length <= product.length ? cited : product;
    return shorter.length >= 8;
  }
  return false;
}

/** Price of the client's own PDP — not a reseller or marketplace listing. */
export function isClientStorefrontObject(
  object: CitedObjectLike,
  client: ClientOfferIdentity,
): boolean {
  const citedHost = hostFromUrl(object.url);
  const clientHost = hostFromUrl(client.url);
  return Boolean(citedHost && clientHost && citedHost === clientHost);
}

/**
 * Same brand/SKU on a host that is not the pasted storefront (Raia, Mercado Livre).
 * Not the shopper's own checkout — and not a rival brand.
 * Grounding `false` still counts: ADR-003 stamps reseller objects false once the
 * storefront is confirmed, so that 3.1.1 does not use the pharmacy price. Twin: rint-app.
 */
export function isClientProductElsewhereObject(
  object: CitedObjectLike,
  client: ClientOfferIdentity,
): boolean {
  if (isClientStorefrontObject(object, client)) return false;
  const nameOk =
    citedNameAlignsWithClient(object.marca, client) ||
    citedNameAlignsWithClient(object.produto, client);
  if (!nameOk) return false;
  const citedHost = hostFromUrl(object.url);
  const clientHost = hostFromUrl(client.url);
  if (citedHost && clientHost && citedHost !== clientHost) return true;
  const loja = object.loja?.trim();
  if (!loja) return false;
  const lojaHost = hostFromUrl(loja.includes("://") ? loja : `https://${loja}`);
  if (lojaHost && clientHost && lojaHost === clientHost) return false;
  return Boolean(loja);
}

export function isLikelyProductUrl(url: string | null | undefined): boolean {
  if (!url) return false;
  try {
    const path = new URL(url).pathname.toLowerCase();
    return /\/(products?|produto|p)\b/.test(path);
  } catch {
    return false;
  }
}

export function productIdentityKey(object: CitedObjectLike): string | null {
  const produto = foldIdentity(object.produto);
  if (!produto) return null;
  return `${foldIdentity(object.marca)}|${produto}`;
}

export function sellerFromObject(object: CitedObjectLike): string | null {
  const store = object.loja?.trim() || null;
  if (store) return store;
  if (isLikelyProductUrl(object.url)) return hostFromUrl(object.url);
  return null;
}

/**
 * `groundingConfirmedClient` — pass the object's own `grounding_confirmed_client` (preferred) or
 * the query's `cliente_foi_citado` fallback when known. Engine twins: `isCitedClientObject` in
 * `src/lib/llm/gemini-structured.ts` (this repo) and `isClientCitedObject` in
 * `rint-app/src/lib/cited-offer.ts`. Grounding is the source of truth: once it has decided this
 * object is NOT the client, a loose name/brand substring match must not override that. The fuzzy
 * fallback stays in play only to disambiguate WHICH object represents the client among several
 * cited objects, or when the caller has no grounding verdict to offer (`undefined`).
 */
export function isClientCitedObject(
  object: CitedObjectLike,
  client: ClientOfferIdentity,
  groundingConfirmedClient?: boolean,
): boolean {
  if (isClientStorefrontObject(object, client)) return true;
  if (groundingConfirmedClient === false) return false;

  return (
    citedNameAlignsWithClient(object.marca, client) ||
    citedNameAlignsWithClient(object.produto, client)
  );
}

export type LostQueryOccupant = { name: string; href: string | null };

export type LostOccupantSpeech =
  | { kind: "one"; name: string; href: string | null }
  | { kind: "several" }
  | { kind: "empty" };

/**
 * Spoken occupant on Conteúdo: one SKU in every loss → name it.
 * Two SKUs → “outros produtos” — do not elect one. Twin: rint-app.
 */
export function lostOccupantSpeech(occupants: LostQueryOccupant[]): LostOccupantSpeech {
  const first = occupants[0];
  if (!first) return { kind: "empty" };
  if (occupants.length === 1) {
    return { kind: "one", name: first.name, href: first.href };
  }
  return { kind: "several" };
}

/**
 * Who took each question the client lost — not the job crown.
 * One SKU in every loss → one name. Two SKUs → keep both (speech does not elect).
 * Twin: rint-app.
 */
export function occupantsFromLostQueries(
  queries: Array<{
    cliente_foi_citado?: boolean;
    gemini_structured?: { objetos_citados?: CitedObjectLike[] };
  }>,
  client: ClientOfferIdentity,
): LostQueryOccupant[] {
  const seen = new Set<string>();
  const offers: LostQueryOccupant[] = [];
  for (const query of queries) {
    if (query.cliente_foi_citado) continue;
    for (const object of query.gemini_structured?.objetos_citados ?? []) {
      if (isClientCitedObject(object, client, object.grounding_confirmed_client ?? false)) {
        continue;
      }
      if (isClientProductElsewhereObject(object, client)) continue;
      const name = formatCitedOfferLabel(object.marca, object.produto) || object.loja?.trim() || "";
      if (!name) continue;
      const key = compactIdentity(name);
      if (!key || seen.has(key)) continue;
      seen.add(key);
      offers.push({ name, href: object.url?.trim() || null });
      break;
    }
  }
  return offers;
}

function modeLabel(counts: Map<string, { label: string; n: number }>): string | null {
  const ranked = [...counts.values()].sort((a, b) => b.n - a.n || a.label.localeCompare(b.label));
  const top = ranked[0];
  if (!top) return null;
  if (ranked[1] && ranked[1].n === top.n) return null;
  return top.label;
}

function bump(map: Map<string, { label: string; n: number }>, label: string | null) {
  const trimmed = label?.trim() || "";
  if (!trimmed) return;
  const key = foldIdentity(trimmed);
  if (!key) return;
  const prev = map.get(key);
  map.set(key, { label: prev?.label ?? trimmed, n: (prev?.n ?? 0) + 1 });
}

function factsFromMentions(
  mentions: CitedObjectLike[],
): Pick<
  CrownedOffer,
  | "url"
  | "preco"
  | "moeda"
  | "prazo_entrega"
  | "avaliacao"
  | "dimensoes"
  | "qualidade"
  | "imagem_url"
  | "atributos"
  | "seller"
  | "sellerHost"
> {
  const sellers = new Map<string, { label: string; n: number }>();
  const urls: string[] = [];
  const attrs = new Set<string>();
  let preco: number | null = null;
  let moeda: string | null = null;
  let prazo: string | null = null;
  let avaliacao: string | null = null;
  let dimensoes: string | null = null;
  let qualidade: string | null = null;
  let imagem_url: string | null = null;
  for (const mention of mentions) {
    bump(sellers, sellerFromObject(mention));
    if (mention.url?.trim() && isLikelyProductUrl(mention.url)) urls.push(mention.url.trim());
    if (preco == null && mention.preco != null && Number.isFinite(mention.preco)) {
      preco = mention.preco;
      moeda = mention.moeda?.trim() || null;
    }
    if (!prazo && mention.prazo_entrega?.trim()) prazo = mention.prazo_entrega.trim();
    if (!avaliacao && mention.avaliacao?.trim()) avaliacao = mention.avaliacao.trim();
    if (!dimensoes && mention.dimensoes?.trim()) dimensoes = mention.dimensoes.trim();
    if (!qualidade && mention.qualidade?.trim()) qualidade = mention.qualidade.trim();
    if (!imagem_url && mention.imagem_url?.trim()) imagem_url = mention.imagem_url.trim();
    for (const attr of mention.atributos ?? []) {
      if (attr.trim()) attrs.add(attr.trim());
    }
  }
  const seller = modeLabel(sellers);
  return {
    seller,
    sellerHost: hostFromUrl(urls[0] ?? null) ?? (seller?.includes(".") ? seller : null),
    url: urls[0] ?? null,
    preco,
    moeda,
    prazo_entrega: prazo,
    avaliacao,
    dimensoes,
    qualidade,
    imagem_url,
    atributos: [...attrs],
  };
}

export function emptyCrownedOffer(): CrownedOffer {
  return {
    confidence: "empty",
    productKey: null,
    marca: null,
    produto: null,
    seller: null,
    sellerHost: null,
    url: null,
    preco: null,
    moeda: null,
    prazo_entrega: null,
    avaliacao: null,
    dimensoes: null,
    qualidade: null,
    imagem_url: null,
    atributos: [],
    candidates: [],
    storeHints: [],
    citingQueryCount: 0,
    persistedCount: 0,
  };
}

/**
 * N = queries of this client SKU that cited some competitor.
 * Crown = strict majority of marca+produto (> N/2) and N ≥ 2.
 * Store-only names are a hint, never a crowned SKU.
 */
export function crownCompetitorSku(input: {
  objectsByQuery: CitedObjectLike[][];
  client: ClientOfferIdentity;
  /** Per-query grounded citation verdict, same order as `objectsByQuery`. See `isClientCitedObject`. */
  citedByQuery?: boolean[];
}): CrownedOffer {
  const citing = input.objectsByQuery
    .map((objects, index) =>
      objects.filter(
        (object) =>
          !isClientCitedObject(
            object,
            input.client,
            object.grounding_confirmed_client ?? input.citedByQuery?.[index],
          ),
      ),
    )
    .filter((objects) => objects.length > 0);
  const persisted = citing.flat();
  const n = citing.length;
  if (n === 0) return { ...emptyCrownedOffer(), persistedCount: 0 };

  const productCounts = new Map<
    string,
    { marca: string | null; produto: string | null; count: number; mentions: CitedObjectLike[] }
  >();
  const storeHints = new Map<string, { label: string; n: number }>();

  for (const objects of citing) {
    const keysThisQuery = new Set<string>();
    for (const object of objects) {
      const key = productIdentityKey(object);
      if (key && !keysThisQuery.has(key)) {
        keysThisQuery.add(key);
        const prev = productCounts.get(key);
        productCounts.set(key, {
          marca: prev?.marca ?? object.marca?.trim() ?? null,
          produto: prev?.produto ?? object.produto?.trim() ?? null,
          count: (prev?.count ?? 0) + 1,
          mentions: [...(prev?.mentions ?? []), object],
        });
      }
      if (!key) bump(storeHints, sellerFromObject(object));
    }
    for (const object of objects) {
      const key = productIdentityKey(object);
      if (!key) continue;
      const row = productCounts.get(key);
      if (row && !row.mentions.includes(object)) row.mentions.push(object);
    }
  }

  const ranked = [...productCounts.entries()]
    .map(([productKey, row]) => ({ productKey, ...row }))
    .sort((a, b) => b.count - a.count || a.productKey.localeCompare(b.productKey));

  const candidates: OfferCandidate[] = ranked.map((row) => ({
    productKey: row.productKey,
    marca: row.marca,
    produto: row.produto,
    count: row.count,
    seller: factsFromMentions(row.mentions).seller,
  }));

  const stores = [...storeHints.values()]
    .sort((a, b) => b.n - a.n || a.label.localeCompare(b.label))
    .map((row) => ({ loja: row.label, count: row.n }));

  const top = ranked[0];
  const second = ranked[1];
  const majority = n >= 2 && top != null && top.count > n / 2;
  const tied = Boolean(top && second && second.count === top.count);

  if (majority && !tied && top) {
    const facts = factsFromMentions(top.mentions);
    return {
      confidence: "clear",
      productKey: top.productKey,
      marca: top.marca,
      produto: top.produto,
      ...facts,
      candidates,
      storeHints: stores,
      citingQueryCount: n,
      persistedCount: persisted.length,
    };
  }

  if (ranked.length > 0) {
    return {
      ...emptyCrownedOffer(),
      confidence: "split",
      candidates,
      storeHints: stores,
      citingQueryCount: n,
      persistedCount: persisted.length,
    };
  }

  if (stores.length > 0) {
    return {
      ...emptyCrownedOffer(),
      confidence: "store_only",
      seller: stores[0]?.loja ?? null,
      storeHints: stores,
      citingQueryCount: n,
      persistedCount: persisted.length,
    };
  }

  return {
    ...emptyCrownedOffer(),
    citingQueryCount: n,
    persistedCount: persisted.length,
  };
}

export function missingOfferCriticals(
  offer: CrownedOffer,
): Array<"produto" | "loja" | "preco" | "prazo" | "avaliacao"> {
  const missing: Array<"produto" | "loja" | "preco" | "prazo" | "avaliacao"> = [];
  if (!offer.produto?.trim()) missing.push("produto");
  if (!offer.seller?.trim()) missing.push("loja");
  if (offer.preco == null) missing.push("preco");
  if (!offer.prazo_entrega?.trim()) missing.push("prazo");
  if (!offer.avaliacao?.trim()) missing.push("avaliacao");
  return missing;
}

export function planCitedOfferFollowUp(offer: CrownedOffer): CitedOfferFollowUpPlan | null {
  if (offer.confidence === "empty" || offer.confidence === "split") return null;
  if (offer.confidence === "store_only") {
    const store = offer.storeHints[0]?.loja?.trim() || offer.seller?.trim();
    if (!store) return null;
    return {
      reason: "missing_product",
      query: `Na ${store}, qual produto específico vocês recomendam, quanto custa, qual o prazo de entrega e a avaliação dos clientes?`,
    };
  }
  const missing = missingOfferCriticals(offer);
  if (missing.length === 0) return null;
  const named = [offer.marca, offer.produto].filter(Boolean).join(" ").trim() || "esse produto";
  const at = offer.seller ? ` na ${offer.seller}` : "";
  const asks: string[] = [];
  if (missing.includes("produto")) asks.push("qual é o produto exato");
  if (missing.includes("loja")) asks.push("onde vende");
  if (missing.includes("preco")) asks.push("quanto custa");
  if (missing.includes("prazo")) asks.push("qual o prazo de entrega");
  if (missing.includes("avaliacao")) asks.push("qual a avaliação");
  return {
    reason: missing.includes("produto")
      ? "missing_product"
      : missing.includes("loja")
        ? "missing_seller"
        : "missing_facts",
    query: `Sobre ${named}${at}: ${asks.join(", ")}?`,
  };
}

export function groundingHostsFromUrls(
  urls: string[],
  sellerHost: string | null,
): Array<{ host: string; href: string | null }> {
  const seen = new Set<string>();
  const rows: Array<{ host: string; href: string | null }> = [];
  for (const raw of urls) {
    const href = raw.trim();
    if (!href) continue;
    const host = hostFromUrl(href);
    if (!host || host === sellerHost) continue;
    if (seen.has(host)) continue;
    seen.add(host);
    rows.push({ host, href });
  }
  return rows;
}

function fillNulls<T extends CitedObjectLike>(left: T, right: CitedObjectLike): T {
  const atributos = [
    ...new Set([...(left.atributos ?? []), ...(right.atributos ?? [])].filter(Boolean)),
  ];
  return {
    ...left,
    marca: left.marca ?? right.marca ?? null,
    loja: left.loja ?? right.loja ?? null,
    produto: left.produto ?? right.produto ?? null,
    url: left.url ?? right.url ?? null,
    preco: left.preco ?? right.preco ?? null,
    moeda: left.moeda ?? right.moeda ?? null,
    prazo_entrega: left.prazo_entrega ?? right.prazo_entrega ?? null,
    avaliacao: left.avaliacao ?? right.avaliacao ?? null,
    dimensoes: left.dimensoes ?? right.dimensoes ?? null,
    qualidade: left.qualidade ?? right.qualidade ?? null,
    imagem_url: left.imagem_url ?? right.imagem_url ?? null,
    atributos,
    // Same "fills nulls only, never overwrites the first turn" rule as every field above —
    // without this, a follow-up's freshly-stamped grounding verdict (ADR-003) was silently
    // discarded whenever it matched an existing object, since this field wasn't listed here.
    grounding_confirmed_client: left.grounding_confirmed_client ?? right.grounding_confirmed_client,
  };
}

/** Follow-up fills nulls only. Never overwrites the first turn. Never drops uncrowned objects. */
export function mergeFollowUpCitedObjects<T extends CitedObjectLike>(
  existing: T[],
  incoming: CitedObjectLike[],
): T[] {
  const result: T[] = existing.map((row) => ({ ...row }));
  for (const next of incoming) {
    const key = productIdentityKey(next);
    const match = key
      ? result.find((row) => productIdentityKey(row) === key)
      : result.find(
          (row) =>
            !productIdentityKey(row) &&
            foldIdentity(row.loja) &&
            foldIdentity(row.loja) === foldIdentity(next.loja),
        );
    if (match) {
      Object.assign(match, fillNulls(match, next));
    } else {
      result.push({ ...next } as T);
    }
  }
  return result;
}
