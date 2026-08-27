import {
  type BrandSurfaceConfig,
  type ClassifiedBrandSurface,
  classifyBrandSurface,
  type SearchConsoleOwnedContentCandidate,
} from "../lib/citation-gold.js";

export type SearchConsoleUrlMatch = {
  candidate: SearchConsoleOwnedContentCandidate;
  surface: ClassifiedBrandSurface;
  score: number;
  confidence: "high" | "medium";
  matched_queries: string[];
  metrics: {
    impressions: number | null;
    clicks: number | null;
    ctr: number | null;
    position: number | null;
  };
};

const DEFAULT_MIN_SCORE = 40;
const MIN_LEXICAL_SCORE = 0.45;

const STOP = new Set([
  "a",
  "o",
  "os",
  "as",
  "de",
  "do",
  "da",
  "dos",
  "das",
  "em",
  "no",
  "na",
  "com",
  "para",
  "por",
  "e",
  "ou",
  "que",
  "qual",
  "como",
  "melhor",
  "brasil",
]);

export function foldSearchText(value: string): string {
  return value
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

function tokens(value: string): string[] {
  return foldSearchText(value)
    .split(" ")
    .filter((token) => token.length >= 2 && !STOP.has(token));
}

function urlText(url: string): string {
  try {
    const parsed = new URL(url);
    return parsed.pathname.split("/").filter(Boolean).join(" ");
  } catch {
    return url;
  }
}

function overlapScore(themeTokens: string[], value: string): number {
  if (themeTokens.length === 0) return 0;
  const valueTokens = new Set(tokens(value));
  if (valueTokens.size === 0) return 0;
  const matched = themeTokens.filter((token) => valueTokens.has(token)).length;
  return matched / themeTokens.length;
}

function candidateQueries(candidate: SearchConsoleOwnedContentCandidate): string[] {
  const queries = candidate.queries?.map((row) => row.query).filter((query) => query.trim()) ?? [];
  if (candidate.topQuery?.trim()) queries.push(candidate.topQuery.trim());
  return [...new Set(queries)];
}

function candidateMetrics(candidate: SearchConsoleOwnedContentCandidate) {
  const queryRows = candidate.queries ?? [];
  const impressions =
    candidate.impressions ??
    queryRows.reduce((sum, row) => sum + (row.impressions ?? 0), 0) ??
    null;
  const clicks =
    candidate.clicks ?? queryRows.reduce((sum, row) => sum + (row.clicks ?? 0), 0) ?? null;
  const ctr = candidate.ctr ?? (impressions && clicks != null ? clicks / impressions : null);
  const weightedPosition =
    queryRows.length > 0
      ? queryRows.reduce(
          (sum, row) => sum + (row.position ?? 0) * Math.max(row.impressions ?? 0, 1),
          0,
        ) / queryRows.reduce((sum, row) => sum + Math.max(row.impressions ?? 0, 1), 0)
      : null;
  return {
    impressions,
    clicks,
    ctr,
    position: candidate.position ?? weightedPosition,
  };
}

function performanceScore(metrics: ReturnType<typeof candidateMetrics>): number {
  const impressions = metrics.impressions ?? 0;
  const impressionScore = Math.min(20, Math.log10(Math.max(impressions, 1)) * 6);
  const position = metrics.position;
  const positionOpportunity = position != null && position >= 4 && position <= 30 ? 10 : 0;
  const ctrOpportunity = metrics.ctr != null && metrics.ctr < 0.04 && impressions >= 100 ? 5 : 0;
  return impressionScore + positionOpportunity + ctrOpportunity;
}

function scoreCandidate(input: {
  theme: string;
  signals?: string[];
  candidate: SearchConsoleOwnedContentCandidate;
}): {
  score: number;
  lexicalScore: number;
  matchedQueries: string[];
  metrics: ReturnType<typeof candidateMetrics>;
} {
  const searchSignals = [input.theme, ...(input.signals ?? [])];
  const queries = candidateQueries(input.candidate);
  const queryScores = queries.map((query) => {
    const score = Math.max(...searchSignals.map((signal) => overlapScore(tokens(signal), query)));
    return { query, score };
  });
  const bestQueryScore = Math.max(0, ...queryScores.map((row) => row.score));
  const slugScore = Math.max(
    ...searchSignals.map((signal) => overlapScore(tokens(signal), urlText(input.candidate.url))),
  );
  const lexicalScore = Math.max(bestQueryScore, slugScore);
  const metrics = candidateMetrics(input.candidate);
  const score = bestQueryScore * 45 + slugScore * 25 + performanceScore(metrics);
  return {
    score: Math.round(score),
    lexicalScore,
    matchedQueries: queryScores
      .filter((row) => row.score > 0)
      .sort((a, b) => b.score - a.score)
      .map((row) => row.query)
      .slice(0, 5),
    metrics,
  };
}

export function selectSearchConsoleUrl(input: {
  theme: string;
  signals?: string[];
  candidates: SearchConsoleOwnedContentCandidate[];
  surfaceConfig: BrandSurfaceConfig;
  minScore?: number;
}): SearchConsoleUrlMatch | null {
  const ranked = input.candidates
    .map((candidate) => {
      const surface = classifyBrandSurface(candidate.url, input.surfaceConfig);
      if (
        surface.kind !== "owned_content_directory" &&
        surface.kind !== "owned_content_subdomain"
      ) {
        return null;
      }
      const scored = scoreCandidate({ theme: input.theme, signals: input.signals, candidate });
      return { candidate, surface, ...scored };
    })
    .filter((row): row is NonNullable<typeof row> => {
      if (!row) return false;
      return (
        row.lexicalScore >= MIN_LEXICAL_SCORE && row.score >= (input.minScore ?? DEFAULT_MIN_SCORE)
      );
    })
    .sort((a, b) => b.score - a.score);

  const winner = ranked[0];
  if (!winner) return null;
  return {
    candidate: winner.candidate,
    surface: winner.surface,
    score: winner.score,
    confidence: winner.score >= 70 ? "high" : "medium",
    matched_queries: winner.matchedQueries,
    metrics: winner.metrics,
  };
}

const INDEX_ROOTS = new Set([
  "blog",
  "blogs",
  "pages",
  "guias",
  "guides",
  "conteudo",
  "conteudos",
  "learn",
  "resources",
]);

export function isOwnedContentIndexPath(pathname: string): boolean {
  const parts = pathname
    .split("/")
    .filter(Boolean)
    .map((part) => part.toLowerCase());
  if (parts.length === 1) return INDEX_ROOTS.has(parts[0] ?? "");
  return parts.length === 2 && parts[0] === "blogs";
}

export function selectSearchConsoleBlogIndex(input: {
  candidates: SearchConsoleOwnedContentCandidate[];
  surfaceConfig: BrandSurfaceConfig;
}): SearchConsoleUrlMatch | null {
  const ranked = input.candidates
    .map((candidate) => {
      const surface = classifyBrandSurface(candidate.url, input.surfaceConfig);
      if (
        surface.kind !== "owned_content_directory" &&
        surface.kind !== "owned_content_subdomain"
      ) {
        return null;
      }
      if (!isOwnedContentIndexPath(surface.path)) return null;
      const metrics = candidateMetrics(candidate);
      return { candidate, surface, metrics, score: metrics.impressions ?? 0 };
    })
    .filter((row): row is NonNullable<typeof row> => Boolean(row))
    .sort((a, b) => b.score - a.score);
  const winner = ranked[0];
  if (!winner) return null;
  return {
    candidate: winner.candidate,
    surface: winner.surface,
    score: winner.score,
    confidence: "medium",
    matched_queries: candidateQueries(winner.candidate).slice(0, 5),
    metrics: winner.metrics,
  };
}
