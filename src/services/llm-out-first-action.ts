/**
 * `track_llm` week action — formulated from the query SET + catalog facts.
 * Contract: rint-app/docs/DIAGNOSIS-DOMINANT.md (envelope `next_steps`).
 * Never paste `query_text[i]`.
 * `first_action` is founder prose (speak / email / fallback). The admin does not parse it
 * into sentences — URLs and attrs on screen come from `content_brief`.
 */

import {
  blogIndexWorkItem,
  buildAlreadyOk,
  buildPdpWorkItems,
  editorialWorkItem,
  isPdpReady,
  type PdpSurfaceIndex,
  priceBrandWorkItem,
  type WeekWorkItem,
} from "../lib/pdp-surface-index.js";
import type { QueryCitationSplit } from "../lib/shopper-question-kind.js";
import { type DecisionStep, step } from "./decision-trace.js";
import { type LlmWeekReason, resolveLlmWeekReason } from "./llm-week-reason.js";

export type CatalogFoundationGap = "attributes" | "description";

const MIN_USEFUL_ATTRIBUTES = 3;
const MIN_DESCRIPTION_CHARS = 80;

export function catalogFoundationFromFields(input: {
  attributes: string[];
  descriptionChars?: number | null;
}): CatalogFoundationGap[] {
  const gaps: CatalogFoundationGap[] = [];
  if (input.attributes.filter((value) => value.trim().length > 0).length < MIN_USEFUL_ATTRIBUTES) {
    gaps.push("attributes");
  }
  if (
    typeof input.descriptionChars === "number" &&
    input.descriptionChars < MIN_DESCRIPTION_CHARS
  ) {
    gaps.push("description");
  }
  return gaps;
}

export function catalogFoundationGaps(
  gaps: readonly string[] | null | undefined,
): CatalogFoundationGap[] {
  return (gaps ?? []).filter(
    (gap): gap is CatalogFoundationGap => gap === "attributes" || gap === "description",
  );
}

export type LlmContentBriefInput = {
  skuName: string;
  brand: string | null;
  queryTexts: string[];
  unusedOwnAttrs: string[];
  skipAttrs: string[];
  readReviewOrRivalStore: boolean;
  existingContentUrl?: string | null;
  existingContentSurface?: "owned_content_directory" | "owned_content_subdomain" | null;
  searchConsoleCoverage?: "covered" | "not_covered" | "unknown";
  targetUrlSource?: "grounding" | "search_console" | null;
  catalogGaps?: CatalogFoundationGap[];
  productUrl?: string | null;
  /** Named storefront pair (said + catalog) — not a stale coherence_level flag. */
  incoherent?: boolean;
  /** Named in the answer; grounding hosts are not the storefront. */
  sourcesWithoutStore?: boolean;
  citationClient?: number;
  citationTotal?: number;
  querySplit?: QueryCitationSplit | null;
  pdpSurface?: PdpSurfaceIndex | null;
  storefrontAccess?: string | null;
  lostQueryTexts?: string[];
  blogIndexUrl?: string | null;
  blogIndexSurface?: "owned_content_directory" | "owned_content_subdomain" | null;
};

export type LlmContentBrief = {
  theme: string;
  sku_name: string;
  brand: string | null;
  first_action: string;
  page_type: "landing_editorial_comparativa";
  surface:
    | "nova_landing_editorial_no_dominio_nao_pdp"
    | "url_editorial_existente_no_dominio_nao_pdp"
    | "cadastro_shopify_antes_da_landing"
    | "pdp_medida"
    | "blog_indice_existente";
  target_url: string | null;
  target_url_source: "grounding" | "search_console" | null;
  existing_content_surface: "owned_content_directory" | "owned_content_subdomain" | null;
  search_console_coverage: "covered" | "not_covered" | "unknown";
  use_attrs: string[];
  skip_attrs: string[];
  grounding_note: "review_not_listing" | null;
  catalog_first: boolean;
  catalog_gaps: CatalogFoundationGap[];
  incoherent?: boolean;
  sourcesWithoutStore?: boolean;
  week_reason: LlmWeekReason;
  work_items?: WeekWorkItem[];
  already_ok?: string[];
  pdp_ready?: boolean;
  trace: DecisionStep[];
};

const STOP = new Set([
  "a",
  "o",
  "as",
  "os",
  "um",
  "uma",
  "de",
  "do",
  "da",
  "dos",
  "das",
  "em",
  "no",
  "na",
  "nos",
  "nas",
  "ao",
  "aos",
  "com",
  "sem",
  "por",
  "para",
  "pelo",
  "pela",
  "e",
  "ou",
  "que",
  "qual",
  "como",
  "mais",
  "melhor",
  "pior",
  "vale",
  "pena",
  "boa",
  "bom",
  "avaliacao",
  "alternativa",
  "vs",
  "versus",
]);

const GEO = new Set(["brasil", "brazil"]);
const FORM: Record<string, string> = {
  gotas: "em gotas",
  po: "em pó",
  capsulas: "em cápsulas",
  capsule: "em cápsulas",
};

type Token = { orig: string; fold: string };

export function foldPhrase(value: string): string {
  return value
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

function tokenize(query: string): Token[] {
  return query
    .trim()
    .split(/\s+/)
    .map((orig) => ({ orig, fold: foldPhrase(orig) }))
    .filter((token) => token.fold.length > 0);
}

function isStop(fold: string): boolean {
  return STOP.has(fold) || fold.length < 2;
}

function stripIdentity(tokens: Token[], skuName: string, brand: string | null): Token[] {
  const brandFolds = new Set(
    foldPhrase(brand ?? "")
      .split(" ")
      .filter((word) => word.length > 1),
  );
  const skuWords = foldPhrase(skuName).split(" ").filter(Boolean);
  const skuFold = skuWords.join(" ");
  const out: Token[] = [];
  for (let i = 0; i < tokens.length; ) {
    if (
      skuWords.length > 0 &&
      tokens
        .slice(i, i + skuWords.length)
        .map((token) => token.fold)
        .join(" ") === skuFold
    ) {
      i += skuWords.length;
      continue;
    }
    const token = tokens[i];
    if (!token) break;
    if (brandFolds.has(token.fold)) {
      i += 1;
      continue;
    }
    out.push(token);
    i += 1;
  }
  return out;
}

function contentFolds(tokens: Token[]): string[] {
  return tokens.map((token) => token.fold).filter((fold) => !isStop(fold) && !GEO.has(fold));
}

function ngramKey(words: string[]): string {
  return words.join(" ");
}

function bestContentNgram(queryFolds: string[][]): string[] | null {
  const counts = new Map<string, { words: string[]; count: number }>();
  for (const folds of queryFolds) {
    const seen = new Set<string>();
    for (let n = 4; n >= 2; n -= 1) {
      for (let i = 0; i + n <= folds.length; i += 1) {
        const words = folds.slice(i, i + n);
        const key = ngramKey(words);
        if (seen.has(key)) continue;
        seen.add(key);
        const prev = counts.get(key);
        if (prev) prev.count += 1;
        else counts.set(key, { words, count: 1 });
      }
    }
  }
  const ranked = [...counts.values()]
    .filter((row) => row.count >= 2)
    .sort((a, b) => b.words.length - a.words.length || b.count - a.count);
  return ranked[0]?.words ?? null;
}

function displayNgram(queries: string[], content: string[]): string {
  for (const query of queries) {
    const tokens = tokenize(query);
    const folds = tokens.map((token) => token.fold);
    for (let i = 0; i < folds.length; i += 1) {
      let t = i;
      const orig: string[] = [];
      let matched = 0;
      while (t < tokens.length && matched < content.length) {
        const token = tokens[t];
        if (!token) break;
        if (token.fold === content[matched]) {
          orig.push(token.orig);
          matched += 1;
          t += 1;
          continue;
        }
        if (matched > 0 && isStop(token.fold)) {
          orig.push(token.orig);
          t += 1;
          continue;
        }
        break;
      }
      if (matched === content.length) return orig.join(" ");
    }
  }
  return content.join(" ");
}

function unigramCounts(queryFolds: string[][]): Map<string, number> {
  const counts = new Map<string, number>();
  for (const folds of queryFolds) {
    for (const word of new Set(folds)) {
      counts.set(word, (counts.get(word) ?? 0) + 1);
    }
  }
  return counts;
}

export function themeFromQuerySet(
  queryTexts: string[],
  skuName: string,
  brand: string | null,
): string {
  const stripped = queryTexts.map((query) =>
    contentFolds(stripIdentity(tokenize(query), skuName, brand)),
  );
  const ngram = bestContentNgram(stripped);
  const counts = unigramCounts(stripped);
  const blob = foldPhrase(queryTexts.join(" "));
  let theme = ngram ? displayNgram(queryTexts, ngram) : skuName;
  const form = Object.entries(FORM).find(
    ([fold]) => (counts.get(fold) ?? 0) >= 2 && !foldPhrase(theme).includes(fold),
  );
  if (form) theme = `${theme} ${form[1]}`;
  if ([...GEO].some((geo) => blob.includes(geo))) theme = `${theme} no Brasil`;
  if (/\balternativa\b|\bvs\b|\bversus\b/.test(blob)) {
    theme = `${theme}, como alternativa ao que a IA citou`;
  }
  const foldedTheme = foldPhrase(theme);
  if (queryTexts.some((query) => foldPhrase(query) === foldedTheme)) {
    return skuName;
  }
  return theme;
}

function sameAttr(left: string, right: string): boolean {
  const a = foldPhrase(left);
  const b = foldPhrase(right);
  if (a === b) return true;
  if (a.length >= 8 && b.includes(a.slice(0, 8))) return true;
  if (b.length >= 8 && a.includes(b.slice(0, 8))) return true;
  return false;
}

export function splitOwnVsRivalAttrs(
  own: string[],
  mentioned: string[],
): { unusedOwn: string[]; skip: string[] } {
  return {
    unusedOwn: own.filter((attr) => !mentioned.some((item) => sameAttr(attr, item))),
    skip: mentioned.filter((item) => !own.some((attr) => sameAttr(attr, item))),
  };
}

export function catalogGapPhrase(gaps: CatalogFoundationGap[]): string {
  const hasDesc = gaps.includes("description");
  const hasAttrs = gaps.includes("attributes");
  if (hasDesc && hasAttrs) return "a descrição e os atributos técnicos";
  if (hasDesc) return "a descrição";
  if (hasAttrs) return "os atributos técnicos";
  return "a descrição e os atributos técnicos";
}

export function formulateTrackLlmFirstAction(input: LlmContentBriefInput): LlmContentBrief {
  const themeSource =
    input.lostQueryTexts && input.lostQueryTexts.length > 0
      ? input.lostQueryTexts
      : input.queryTexts;
  const theme = themeFromQuerySet(themeSource, input.skuName, input.brand);
  const catalogGaps = catalogFoundationGaps(input.catalogGaps);
  const catalogFirst = catalogGaps.length > 0 && !input.incoherent;
  const useAttrs = catalogFirst ? [] : input.unusedOwnAttrs.slice(0, 2);
  const skip =
    input.skipAttrs.find((attr) => /nsf|selo|certif|estudo|vegan/i.test(attr)) ??
    input.skipAttrs[0] ??
    null;
  const skipAttrs = skip ? [skip] : [];
  const grounding_note = input.readReviewOrRivalStore ? ("review_not_listing" as const) : null;
  const existingUrl = input.existingContentUrl?.trim() || null;
  const productUrl = input.productUrl?.trim() || null;
  const blogIndexUrl = input.blogIndexUrl?.trim() || null;
  const week_reason = resolveLlmWeekReason({
    catalogFirst,
    storefrontIncoherent: Boolean(input.incoherent),
    sourcesWithoutStore: Boolean(input.sourcesWithoutStore),
    citationClient: input.citationClient ?? 0,
    citationTotal: input.citationTotal ?? 0,
    split: input.querySplit ?? null,
  });
  const pdpReady = isPdpReady({
    storefrontAccess: input.storefrontAccess,
    catalogFirst,
    split: input.querySplit ?? null,
  });
  const workFromPdp = input.pdpSurface
    ? buildPdpWorkItems({
        index: input.pdpSurface,
        brand: input.brand,
        lostQueryTexts: input.lostQueryTexts ?? [],
      })
    : [];
  const alreadyOk = input.pdpSurface ? buildAlreadyOk(input.pdpSurface) : [];
  const trace: DecisionStep[] = [
    step(
      "catalog_foundation",
      "O cadastro deste produto tem descrição útil e pelo menos 3 atributos técnicos preenchidos?",
      catalogFirst,
      catalogFirst ? "Não — cadastro incompleto" : "Sim",
      { catalog_gaps: catalogGaps, incoherent: Boolean(input.incoherent) },
    ),
    step(
      "existing_own_content",
      "A IA já leu (ou existe) uma página própria relevante sobre o tema?",
      !catalogFirst && Boolean(existingUrl),
      existingUrl ? "Sim" : "Não",
      { existing_content_url: existingUrl },
      catalogFirst ? "Não avaliado — o cadastro precisa ser completado primeiro." : undefined,
    ),
  ];
  const shared = {
    theme,
    sku_name: input.skuName,
    brand: input.brand,
    page_type: "landing_editorial_comparativa" as const,
    search_console_coverage: input.searchConsoleCoverage ?? "unknown",
    use_attrs: useAttrs,
    skip_attrs: skipAttrs,
    grounding_note,
    incoherent: Boolean(input.incoherent),
    sourcesWithoutStore: Boolean(input.sourcesWithoutStore),
    week_reason,
    pdp_ready: pdpReady,
    trace,
  };
  if (catalogFirst) {
    const what = catalogGapPhrase(catalogGaps);
    return {
      ...shared,
      surface: "cadastro_shopify_antes_da_landing",
      target_url: productUrl,
      target_url_source: null,
      existing_content_surface: existingUrl ? (input.existingContentSurface ?? null) : null,
      catalog_first: true,
      catalog_gaps: catalogGaps,
      work_items: [
        {
          id: "catalog_fill",
          where: "shopify",
          do: `Complete no Shopify ${what} deste produto.`,
        },
      ],
      already_ok: [],
      first_action: `Complete no Shopify ${what} deste produto. O cadastro é a base; sem isso um guia novo não tem o que dizer.`,
    };
  }
  if (input.incoherent) {
    return {
      ...shared,
      surface: "pdp_medida",
      target_url: productUrl,
      target_url_source: null,
      existing_content_surface: null,
      catalog_first: false,
      catalog_gaps: [],
      work_items: [priceBrandWorkItem()],
      already_ok: [],
      first_action: productUrl
        ? "A IA já fala de você, mas o preço ou a marca não batem com a loja. Deixe o cadastro claro nesta página do produto."
        : "A IA já fala de você, mas o preço ou a marca não batem com a loja. Crie uma página no seu site que deixe preço e marca iguais à loja.",
    };
  }
  if (existingUrl) {
    return {
      ...shared,
      surface: "url_editorial_existente_no_dominio_nao_pdp",
      target_url: existingUrl,
      target_url_source: input.targetUrlSource ?? null,
      existing_content_surface: input.existingContentSurface ?? null,
      catalog_first: false,
      catalog_gaps: [],
      work_items: [editorialWorkItem()],
      already_ok: [],
      first_action: `Melhore esta página já existente no domínio da loja. Use o que a loja já tem. Não crie outra URL.`,
    };
  }
  if (blogIndexUrl && pdpReady) {
    return {
      ...shared,
      surface: "blog_indice_existente",
      target_url: blogIndexUrl,
      target_url_source: input.targetUrlSource ?? "search_console",
      existing_content_surface: input.blogIndexSurface ?? "owned_content_directory",
      catalog_first: false,
      catalog_gaps: [],
      work_items: [blogIndexWorkItem()],
      already_ok: alreadyOk,
      first_action:
        "Crie um conteúdo neste blog. O Search Console já vê este endereço; nenhum post deste tema apareceu. Não invente o endereço do post.",
    };
  }
  return {
    ...shared,
    surface: "pdp_medida",
    target_url: productUrl,
    target_url_source: null,
    existing_content_surface: null,
    catalog_first: false,
    catalog_gaps: [],
    work_items: workFromPdp,
    already_ok: alreadyOk,
    first_action:
      week_reason === "sources_without_store"
        ? productUrl
          ? "A IA já fala o nome, mas foi ler em outros sites. Escreva nesta página do produto os fatos da loja."
          : "A IA já fala o nome, mas foi ler em outros sites. Publique uma página sua com os fatos da loja."
        : productUrl
          ? "A sua página do produto já existe. Falta a IA enxergar o que ela diz para quem ainda não sabe o seu nome. Não crie outra página."
          : "Falta a IA enxergar uma página sua para quem ainda não sabe o seu nome.",
  };
}
