/**
 * Page-week judge — door, panel match, structured fiche on the street. One first step.
 * Contract: rint-app/docs/DIAGNOSIS-DOMINANT.md
 * Preview twin: rint-app/src/lib/diagnosis-pdp-week-judge.ts
 * Pure rules. No I/O. No Gemini.
 */

export type StorefrontAccess = "open" | "password" | "blocked" | "unverified";

export type PageMove =
  | "abrir_senha"
  | "tirar_bloqueio"
  | "conferir_publico"
  | "expor_schema"
  | "ligar_loja_da_url";

export type PageWeekAbstainReason = "ok" | "buraco" | "thin_catalog" | "marketplace";

export type PageWeekJudgeInput = {
  access: StorefrontAccess | null;
  hasJsonLd: boolean | null;
  shopifyConnected: boolean;
  /** Connected shop, this SKU was not in Admin — not a marketplace URL. */
  panelMismatch: boolean;
  marketplaceUrl: boolean;
};

export type PageWeekJudgment = {
  move: PageMove | undefined;
  abstainReason: PageWeekAbstainReason | null;
};

export function judgePageWeek(input: PageWeekJudgeInput): PageWeekJudgment {
  if (input.access === "password") {
    return { move: "abrir_senha", abstainReason: null };
  }
  if (input.access === "blocked") {
    return { move: "tirar_bloqueio", abstainReason: null };
  }
  if (input.panelMismatch && !input.marketplaceUrl) {
    return { move: "ligar_loja_da_url", abstainReason: null };
  }
  if (input.access === "unverified") {
    return { move: "conferir_publico", abstainReason: null };
  }
  if (!input.shopifyConnected) {
    return { move: undefined, abstainReason: "buraco" };
  }
  if (input.access === "open" && input.hasJsonLd === false) {
    return { move: "expor_schema", abstainReason: null };
  }
  return { move: undefined, abstainReason: "ok" };
}
