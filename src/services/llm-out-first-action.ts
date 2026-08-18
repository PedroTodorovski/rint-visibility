/**
 * `track_llm` week action — formulated from the query SET + catalog facts.
 * Contract: rint-app/docs/DIAGNOSIS-DOMINANT.md (envelope `next_steps`).
 * Never paste `query_text[i]`.
 * `first_action` is founder prose (speak / email / fallback). The admin does not parse it
 * into sentences — URLs and attrs on screen come from `content_brief`.
 */

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
};

export type LlmContentBrief = {
  theme: string;
  sku_name: string;
  brand: string | null;
  first_action: string;
  page_type: "landing_editorial_comparativa";
  surface:
    | "nova_landing_editorial_no_dominio_nao_pdp"
    | "url_editorial_existente_no_dominio_nao_pdp";
  target_url: string | null;
  target_url_source: "grounding" | "search_console" | null;
  existing_content_surface: "owned_content_directory" | "owned_content_subdomain" | null;
  search_console_coverage: "covered" | "not_covered" | "unknown";
  use_attrs: string[];
  skip_attrs: string[];
  grounding_note: "review_not_listing" | null;
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

export function formulateTrackLlmFirstAction(input: LlmContentBriefInput): LlmContentBrief {
  const theme = themeFromQuerySet(input.queryTexts, input.skuName, input.brand);
  const useAttrs = input.unusedOwnAttrs.slice(0, 2);
  const skip =
    input.skipAttrs.find((attr) => /nsf|selo|certif|estudo|vegan/i.test(attr)) ??
    input.skipAttrs[0] ??
    null;
  const skipAttrs = skip ? [skip] : [];
  const use = useAttrs.join(" e ");
  const skipLine = skip ? ` Não escreva ${skip} — o ${input.skuName} não tem.` : "";
  const grounding_note = input.readReviewOrRivalStore ? ("review_not_listing" as const) : null;
  const why = grounding_note ? " A IA leu review e a loja de outra marca, não a sua ficha." : "";
  const targetUrl = input.existingContentUrl?.trim() || null;
  const action = targetUrl
    ? `Melhore esta landing editorial/comparativa já existente: ${targetUrl}. Use o que a loja já tem: ${use}. Reforce o link para ${input.skuName}.${skipLine}${why}`
    : `Crie uma landing editorial/comparativa no domínio da loja, com URL própria fora da PDP, sobre ${theme}. Use o que a loja já tem: ${use}. Inclua um link para ${input.skuName}.${skipLine}${why}`;
  return {
    theme,
    sku_name: input.skuName,
    brand: input.brand,
    page_type: "landing_editorial_comparativa",
    surface: targetUrl
      ? "url_editorial_existente_no_dominio_nao_pdp"
      : "nova_landing_editorial_no_dominio_nao_pdp",
    target_url: targetUrl,
    target_url_source: targetUrl ? (input.targetUrlSource ?? null) : null,
    existing_content_surface: targetUrl ? (input.existingContentSurface ?? null) : null,
    search_console_coverage: input.searchConsoleCoverage ?? "unknown",
    use_attrs: useAttrs,
    skip_attrs: skipAttrs,
    grounding_note,
    first_action: action,
  };
}
