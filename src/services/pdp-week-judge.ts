/**
 * Page-week judge — door, panel match, structured fiche on the street. One first step.
 * Contract: rint-app/docs/DIAGNOSIS-DOMINANT.md
 * Preview twin: rint-app/src/lib/diagnosis-pdp-week-judge.ts
 * Pure rules. No I/O. No Gemini.
 */

import { type DecisionStep, step } from "./decision-trace.js";

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
  trace: DecisionStep[];
};

export function judgePageWeek(input: PageWeekJudgeInput): PageWeekJudgment {
  const gates: Array<[string, string, boolean]> = [
    ["password", "A página pede senha?", input.access === "password"],
    ["blocked", "A página está bloqueada?", input.access === "blocked"],
    [
      "panel_mismatch",
      "A loja está ligada, mas este produto está registrado em outro painel — e não é marketplace conhecido?",
      input.panelMismatch && !input.marketplaceUrl,
    ],
    ["unverified", "Ainda não conseguimos verificar se a página é mesmo pública?", input.access === "unverified"],
    ["not_connected", "Não há loja ligada a este produto?", !input.shopifyConnected],
    [
      "missing_schema",
      "A página está aberta, mas sem a ficha técnica legível pela IA?",
      input.access === "open" && input.hasJsonLd === false,
    ],
  ];

  let decided = false;
  const trace: DecisionStep[] = gates.map(([id, question, value]) => {
    const fired = value && !decided;
    if (fired) decided = true;
    return step(id, question, fired, value ? "Sim" : "Não", { value });
  });

  function finish(result: Omit<PageWeekJudgment, "trace">): PageWeekJudgment {
    if (!decided) {
      trace.push(step("ok", "Nenhuma das anteriores bateu — a página está ok?", true, "Sim"));
    }
    return { ...result, trace };
  }

  if (input.access === "password") {
    return finish({ move: "abrir_senha", abstainReason: null });
  }
  if (input.access === "blocked") {
    return finish({ move: "tirar_bloqueio", abstainReason: null });
  }
  if (input.panelMismatch && !input.marketplaceUrl) {
    return finish({ move: "ligar_loja_da_url", abstainReason: null });
  }
  if (input.access === "unverified") {
    return finish({ move: "conferir_publico", abstainReason: null });
  }
  if (!input.shopifyConnected) {
    return finish({ move: undefined, abstainReason: "buraco" });
  }
  if (input.access === "open" && input.hasJsonLd === false) {
    return finish({ move: "expor_schema", abstainReason: null });
  }
  return finish({ move: undefined, abstainReason: "ok" });
}
