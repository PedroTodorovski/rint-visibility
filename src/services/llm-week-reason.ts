import { namedOnlyCitation, type QueryCitationSplit } from "../lib/shopper-question-kind.js";

/**
 * One switch for lime + “O que fazer agora”.
 * Twin: rint-app/src/lib/diagnosis-week-reason.ts
 *
 * `incoherent` is the named storefront pair only — never pharmacy / ML,
 * never a stale `coherence_level` flag.
 */

export const LLM_WEEK_REASONS = [
  "catalog_first",
  "incoherent",
  "sources_without_store",
  "out",
  "named_only",
  "category_partial",
  "partial",
  "article",
] as const;

export type LlmWeekReason = (typeof LLM_WEEK_REASONS)[number];

export type LlmWeekReasonInput = {
  catalogFirst: boolean;
  storefrontIncoherent: boolean;
  sourcesWithoutStore: boolean;
  citationClient: number;
  citationTotal: number;
  split?: QueryCitationSplit | null;
};

export function isLlmWeekReason(value: unknown): value is LlmWeekReason {
  return typeof value === "string" && (LLM_WEEK_REASONS as readonly string[]).includes(value);
}

export function resolveLlmWeekReason(input: LlmWeekReasonInput): LlmWeekReason {
  const total = input.citationTotal;
  const cited = input.citationClient;
  const measured = total > 0;
  const zero = measured && cited === 0;
  const partialDoor = measured && cited > 0 && cited < total;

  if (input.catalogFirst && !input.storefrontIncoherent) return "catalog_first";
  if (input.storefrontIncoherent) return "incoherent";
  if (input.sourcesWithoutStore && (zero || !measured)) return "sources_without_store";
  if (zero) return "out";
  if (partialDoor) {
    const split = input.split;
    if (split && namedOnlyCitation(split)) return "named_only";
    if (split && split.categoryTotal > 0 && split.categoryCited < split.categoryTotal) {
      return "category_partial";
    }
    return "partial";
  }
  return "article";
}
