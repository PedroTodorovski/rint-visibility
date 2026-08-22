/**
 * Product-week judge — comparable facts, shopper order, one first step.
 * Contract: rint-app/docs/DIAGNOSIS-DOMINANT.md
 * Preview twin: rint-app/src/lib/diagnosis-produto-week-judge.ts
 * Pure rules. No I/O. No Gemini.
 */

import type { OfferConfidence } from "../lib/cited-offer.js";
import { type DecisionStep, step } from "./decision-trace.js";

type ProductFollowupReason = "missing_product" | "missing_seller" | "missing_facts" | null;
type ProductPrimaryDimension = "preco" | "avaliacao" | "composicao" | "tamanho" | "embalagem";
type ProductLosingDimension = ProductPrimaryDimension | null;
type ProductMove =
  | "aceitar_gap"
  | "mudar_preco"
  | "reformular_sku"
  | "mudar_tamanho"
  | "mudar_embalagem"
  | "esperar_followup";

export type ProductWeekDimension =
  | "preco"
  | "prazo"
  | "avaliacao"
  | "composicao"
  | "tamanho"
  | "embalagem";

export type ProductWeekContribution = {
  dimension: ProductWeekDimension;
  role: "primary" | "extra";
};

export type ProductWeekAbstainReason =
  | Exclude<ProductFollowupReason, null>
  | "store_only"
  | "empty"
  | "split"
  | "no_comparable_loss";

export type ProductWeekMoney = {
  amount?: number | null;
  currency?: string | null;
  label?: string | null;
};

export type ProductWeekJudgeInput = {
  confidence: OfferConfidence;
  followupReason: ProductFollowupReason;
  priceClient: ProductWeekMoney | null;
  priceCrowned: ProductWeekMoney | null;
  clientDose?: string | null;
  crownedDose?: string | null;
  ratingClient: string | null;
  ratingCrowned: string | null;
  shippingClient: string | null;
  shippingCrowned: string | null;
  skipAttrs: string[];
  useAttrs?: string[];
  clientDimensions?: string | null;
  crownedDimensions?: string | null;
  clientQuality?: string | null;
  crownedQuality?: string | null;
};

export type ProductWeekJudgment = {
  contributions: ProductWeekContribution[];
  primaryDimension: ProductLosingDimension;
  move: ProductMove | undefined;
  abstainReason: ProductWeekAbstainReason | null;
  trace: DecisionStep[];
};

const DIMENSION_QUESTION: Record<ProductPrimaryDimension, string> = {
  preco: "Diferença de preço real — mesma moeda, mesma unidade, 15% ou mais?",
  avaliacao: "Diferença de avaliação real — os dois com nota, 0,4 estrela ou mais?",
  composicao: "O concorrente tem um selo, certificação ou fórmula que a loja não declara?",
  tamanho: "Tamanho ou dose realmente diferentes?",
  embalagem: "Embalagem realmente diferente?",
};

/** Relative ticket gap below this is “parecido”, not a shopper-deciding loss. */
const PRICE_MATERIAL_RATIO = 0.15;
/** 4,6 vs 4,8 must not beat formula. Serum-scale gaps still compete. */
const RATING_MATERIAL_DELTA = 0.4;

const SHOPPER_ORDER: ProductPrimaryDimension[] = [
  "preco",
  "avaliacao",
  "composicao",
  "tamanho",
  "embalagem",
];

function fold(value: string | null | undefined): string {
  return (value ?? "")
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

function isFormulaSkip(attr: string): boolean {
  if (/garantia|prazo|entrega|frete|avalia|estrela|rating|\b\d+\s*dias\b/i.test(attr)) {
    return false;
  }
  return /nsf|vegan|certif|selo|fórmula|formula|composi|carbono|estudo/i.test(attr);
}

function normalizeCurrency(raw: string | null | undefined): string | null {
  if (!raw?.trim()) return null;
  const u = raw.toUpperCase();
  if (/\bUSD\b/.test(u) || /US\$/.test(u)) return "USD";
  if (/\bBRL\b/.test(u) || /R\$/.test(u)) return "BRL";
  if (/\bEUR\b/.test(u) || /€/.test(u)) return "EUR";
  return null;
}

function parseMoneyAmount(label: string | null | undefined): number | null {
  if (!label?.trim()) return null;
  const core = label.trim().replace(/[^\d,.-]/g, "");
  if (!core || core === "-" || core === ".") return null;
  const comma = core.lastIndexOf(",");
  const dot = core.lastIndexOf(".");
  let normalized = core;
  if (comma >= 0 && dot >= 0) {
    normalized = comma > dot ? core.replace(/\./g, "").replace(",", ".") : core.replace(/,/g, "");
  } else if (comma >= 0) {
    const frac = core.length - comma - 1;
    normalized = frac === 3 ? core.replace(/,/g, "") : core.replace(",", ".");
  } else if (dot >= 0) {
    const frac = core.length - dot - 1;
    if (frac === 3) normalized = core.replace(/\./g, "");
  }
  const n = Number(normalized);
  return Number.isFinite(n) ? n : null;
}

function resolvedMoney(side: ProductWeekMoney | null): { amount: number; currency: string } | null {
  if (!side) return null;
  const amount =
    side.amount != null && Number.isFinite(side.amount)
      ? side.amount
      : parseMoneyAmount(side.label);
  const currency = normalizeCurrency(side.currency) ?? normalizeCurrency(side.label);
  if (amount == null || !currency) return null;
  return { amount, currency };
}

function parseRating(value: string | null | undefined): number | null {
  if (!value?.trim()) return null;
  const match = value.trim().match(/(\d+[.,]\d+|\d+)/);
  if (!match?.[1]) return null;
  const n = Number(match[1].replace(",", "."));
  if (!Number.isFinite(n) || n < 0 || n > 5.5) return null;
  return n;
}

function parseDeliveryDays(value: string | null | undefined): number | null {
  if (!value?.trim() || !/\bdias?\b/i.test(value)) return null;
  const nums = [...value.matchAll(/(\d+)/g)].map((match) => Number(match[1]));
  const days = nums.filter((n) => Number.isFinite(n) && n > 0 && n <= 90);
  if (days.length === 0) return null;
  return Math.max(...days);
}

function scoopCount(parts: Array<string | null | undefined>): number | null {
  const blob = parts.filter(Boolean).join(" ");
  const match = blob.match(/(\d+)\s*scoops?/i);
  if (!match?.[1]) return null;
  const n = Number(match[1]);
  return Number.isFinite(n) ? n : null;
}

function unitsComparable(input: ProductWeekJudgeInput): boolean {
  const client = scoopCount([input.clientDose, input.clientDimensions, ...(input.useAttrs ?? [])]);
  const crowned = scoopCount([
    input.crownedDose,
    input.crownedDimensions,
    ...(input.skipAttrs ?? []),
  ]);
  if (client != null && crowned != null && client !== crowned) return false;
  return true;
}

function priceCompetes(input: ProductWeekJudgeInput): boolean {
  const client = resolvedMoney(input.priceClient);
  const crowned = resolvedMoney(input.priceCrowned);
  if (!client || !crowned) return false;
  if (client.currency !== crowned.currency) return false;
  if (!unitsComparable(input)) return false;
  if (client.amount <= crowned.amount) return false;
  const ratio = (client.amount - crowned.amount) / client.amount;
  return ratio >= PRICE_MATERIAL_RATIO;
}

function ratingCompetes(input: ProductWeekJudgeInput): boolean {
  const client = parseRating(input.ratingClient);
  const crowned = parseRating(input.ratingCrowned);
  if (client == null || crowned == null) return false;
  return crowned - client >= RATING_MATERIAL_DELTA;
}

function formulaCompetes(input: ProductWeekJudgeInput): boolean {
  return input.skipAttrs.some((attr) => isFormulaSkip(attr));
}

function factsDiffer(left: string | null | undefined, right: string | null | undefined): boolean {
  const a = fold(left);
  const b = fold(right);
  if (!a || !b) return false;
  return a !== b;
}

function sizeCompetes(input: ProductWeekJudgeInput): boolean {
  return factsDiffer(
    input.clientDimensions ?? input.clientDose,
    input.crownedDimensions ?? input.crownedDose,
  );
}

function packCompetes(input: ProductWeekJudgeInput): boolean {
  if (isFormulaSkip(input.clientQuality ?? "") || isFormulaSkip(input.crownedQuality ?? "")) {
    return false;
  }
  return factsDiffer(input.clientQuality, input.crownedQuality);
}

function prazoLost(input: ProductWeekJudgeInput): boolean {
  const client = parseDeliveryDays(input.shippingClient);
  const crowned = parseDeliveryDays(input.shippingCrowned);
  if (client == null || crowned == null) return false;
  return client > crowned;
}

function moveFor(dimension: ProductPrimaryDimension): ProductMove {
  if (dimension === "preco") return "mudar_preco";
  if (dimension === "tamanho") return "mudar_tamanho";
  if (dimension === "embalagem") return "mudar_embalagem";
  return "aceitar_gap";
}

function competingDimensions(input: ProductWeekJudgeInput): ProductPrimaryDimension[] {
  const lost: ProductPrimaryDimension[] = [];
  if (priceCompetes(input)) lost.push("preco");
  if (ratingCompetes(input)) lost.push("avaliacao");
  if (formulaCompetes(input)) lost.push("composicao");
  if (lost.length === 0 && sizeCompetes(input)) lost.push("tamanho");
  if (lost.length === 0 && packCompetes(input)) lost.push("embalagem");
  return SHOPPER_ORDER.filter((dimension) => lost.includes(dimension));
}

function abstainFromOffer(input: ProductWeekJudgeInput): ProductWeekAbstainReason | null {
  if (input.confidence === "empty") return "empty";
  if (input.confidence === "store_only" || input.followupReason === "missing_product") {
    return input.followupReason === "missing_product" ? "missing_product" : "store_only";
  }
  if (input.followupReason === "missing_seller") return "missing_seller";
  if (input.followupReason === "missing_facts") return "missing_facts";
  if (input.confidence === "split") return "split";
  return null;
}

export function judgeProductWeek(input: ProductWeekJudgeInput): ProductWeekJudgment {
  const abstain = abstainFromOffer(input);
  const offerTrace = step(
    "offer_confidence",
    "Há uma oferta do concorrente clara o suficiente para comparar (produto, loja e fatos definidos)?",
    Boolean(abstain),
    abstain ? `Não — ${abstain}` : "Sim",
    { confidence: input.confidence, followup_reason: input.followupReason },
  );

  if (abstain) {
    return {
      contributions: [],
      primaryDimension: null,
      move: undefined,
      abstainReason: abstain,
      trace: [offerTrace],
    };
  }

  // sizeCompetes/packCompetes mirror competingDimensions()'s own short-circuit: they
  // only decide the trilha when nothing earlier in SHOPPER_ORDER already fired. The
  // "decided" walk below reproduces that same gating for the trace's fired flags.
  const flags: Record<ProductPrimaryDimension, boolean> = {
    preco: priceCompetes(input),
    avaliacao: ratingCompetes(input),
    composicao: formulaCompetes(input),
    tamanho: sizeCompetes(input),
    embalagem: packCompetes(input),
  };

  let decided = false;
  const dimensionTrace = SHOPPER_ORDER.map((dimension) => {
    const value = flags[dimension];
    const fired = value && !decided;
    if (fired) decided = true;
    return step(dimension, DIMENSION_QUESTION[dimension], fired, value ? "Sim" : "Não");
  });
  const trace = [offerTrace, ...dimensionTrace];

  const ranked = competingDimensions(input);
  const primary = ranked[0] ?? null;
  if (!primary) {
    trace.push(
      step(
        "no_comparable_loss",
        "Nenhuma diferença real encontrada em nenhum critério — aceitar a diferença como está?",
        true,
        "Sim",
      ),
    );
    return {
      contributions: [],
      primaryDimension: null,
      move: "aceitar_gap",
      abstainReason: "no_comparable_loss",
      trace,
    };
  }

  const contributions: ProductWeekContribution[] = [{ dimension: primary, role: "primary" }];
  if (primary === "preco" && prazoLost(input)) {
    contributions.push({ dimension: "prazo", role: "extra" });
  }

  return {
    contributions,
    primaryDimension: primary,
    move: moveFor(primary),
    abstainReason: null,
    trace,
  };
}
