/**
 * `track_produto` week action — one frank move on the offering.
 * Contract: rint-app/docs/DIAGNOSIS-DOMINANT.md (`next_steps.product_brief`).
 * Preview twin: rint-app/src/lib/diagnosis-produto-first-action.ts
 * Never paste `query_text`. Never “A IA recomenda {crowned} no lugar do {sku}”.
 */

import type { OfferConfidence } from "../lib/cited-offer.js";
import type { ProductWeekContribution, ProductWeekDimension } from "./produto-week-judge.js";

export type ProductMove =
  | "aceitar_gap"
  | "mudar_preco"
  | "reformular_sku"
  | "mudar_tamanho"
  | "mudar_embalagem"
  | "esperar_followup";

export type ProductLosingDimension =
  | "preco"
  | "avaliacao"
  | "composicao"
  | "tamanho"
  | "embalagem"
  | null;

export type ProductFollowupReason = "missing_product" | "missing_seller" | "missing_facts" | null;

export type ProductBriefInput = {
  skuName: string;
  brand: string | null;
  productUrl: string | null;
  confidence: OfferConfidence;
  crownedName: string | null;
  crownedSeller: string | null;
  storeHint: string | null;
  priceClient: string | null;
  priceCrowned: string | null;
  useAttrs: string[];
  skipAttrs: string[];
  followupReason: ProductFollowupReason;
  losingDimension?: ProductLosingDimension;
  move?: ProductMove;
  contributions?: ProductWeekContribution[];
};

export type ProductBrief = {
  theme: string;
  sku_name: string;
  brand: string | null;
  first_action: string;
  support_line: string;
  move: ProductMove;
  surface: "sku_da_loja";
  target_url: string | null;
  losing_dimension: ProductLosingDimension;
  crowned_name: string | null;
  crowned_seller: string | null;
  price_client: string | null;
  price_crowned: string | null;
  use_attrs: string[];
  skip_attrs: string[];
  followup_reason: ProductFollowupReason;
  contributions: ProductWeekContribution[];
};

function clean(attrs: string[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const attr of attrs) {
    const text = attr.trim();
    if (!text || seen.has(text)) continue;
    seen.add(text);
    out.push(text);
  }
  return out;
}

function join(parts: string[]): string {
  return parts.filter((part) => part.trim()).join(" ");
}

function isFormulaSkip(attr: string): boolean {
  if (/garantia|prazo|entrega|frete|avalia|estrela|rating|\b\d+\s*dias\b/i.test(attr)) {
    return false;
  }
  return /nsf|vegan|certif|selo|fórmula|formula|composi|carbono|estudo/i.test(attr);
}

function formulaSkipRank(attr: string): number {
  if (/nsf/i.test(attr)) return 0;
  if (/vegan|certif|selo/i.test(attr)) return 1;
  return 2;
}

/** One skip chip, matching the named formula fact — never garantia/prazo as “fórmula”. */
function glassSkipAttrs(attrs: string[]): string[] {
  return clean(attrs)
    .filter(isFormulaSkip)
    .sort((a, b) => formulaSkipRank(a) - formulaSkipRank(b))
    .slice(0, 1);
}

function skipFact(attrs: string[]): string {
  return glassSkipAttrs(attrs)[0] ?? "";
}

function whoLine(crowned: string | null, sku: string): string {
  if (!crowned) return "A IA recomendou outro produto neste diagnóstico — não o seu.";
  if (!sku || sku === "este produto") return `A IA recomendou ${crowned} — não o seu.`;
  return `A IA recomendou ${crowned} — não o ${sku}.`;
}

function extraWeight(
  contributions: ProductWeekContribution[] | undefined,
): ProductWeekDimension | null {
  return contributions?.some((row) => row.dimension === "prazo") ? "prazo" : null;
}

function lostOnLine(
  dimension: ProductLosingDimension,
  skip: string,
  priceClient: string | null,
  priceCrowned: string | null,
  extra: ProductWeekDimension | null,
): string {
  if (dimension === "preco" && extra === "prazo") {
    return priceClient && priceCrowned
      ? `Não foi só a fórmula: o ticket ficou acima (${priceClient} vs ${priceCrowned}) e o prazo também perdeu.`
      : "Não foi só a fórmula: o ticket ficou acima e o prazo também perdeu.";
  }
  if (dimension === "preco") {
    return priceClient && priceCrowned
      ? `Não foi a fórmula nem o prazo: o preço da loja é ${priceClient}; o dele veio a ${priceCrowned}.`
      : "Não foi a fórmula nem o prazo: o preço da loja perdeu para o produto que a IA recomendou.";
  }
  if (dimension === "avaliacao") {
    return "Não foi o preço nem o prazo: o outro ganhou na avaliação.";
  }
  if (dimension === "tamanho") {
    return "Não foi o preço nem o prazo: ela escolheu o outro pelo tamanho ou pela dose.";
  }
  if (dimension === "embalagem") {
    return "Não foi o preço nem o prazo: ela escolheu o outro pela embalagem.";
  }
  return skip
    ? `Não foi o preço nem o prazo: ela escolheu o outro pela fórmula (${skip}).`
    : "Não foi o preço nem o prazo: ela escolheu o outro pela fórmula — o que o produto é.";
}

function weekLine(
  move: ProductMove,
  dimension: ProductLosingDimension,
  skip: string,
  sku: string,
): string {
  if (move === "mudar_preco") {
    return "Esta semana: ajuste o preço no Shopify. Um artigo no site não resolve um preço pior.";
  }
  if (move === "reformular_sku") {
    return skip
      ? `Esta semana: mude a fórmula de verdade no ${sku} — não copie ${skip} no Shopify.`
      : `Esta semana: mude a fórmula de verdade no ${sku} — no produto, não no texto do site.`;
  }
  if (move === "mudar_tamanho") {
    return "Esta semana: mude o tamanho ou a dose no produto — ou aceite que, nesta pergunta, o seu perde.";
  }
  if (move === "mudar_embalagem") {
    return "Esta semana: mude a embalagem — ou aceite que, nesta pergunta, o seu perde.";
  }
  if (dimension === "avaliacao") {
    return "Esta semana: não invente nota nem estudo no Shopify. Melhore a prova real, ou aceite que nesta pergunta o seu perde.";
  }
  return skip
    ? `Esta semana: não mude o ${sku} e não copie ${skip} no Shopify. O seu produto não tem isso.`
    : "Esta semana: não mude o produto e não invente no Shopify o que ele não tem.";
}

function whyLine(dimension: ProductLosingDimension): string {
  if (dimension === "preco") {
    return "Por que isso importa: o que atacar esta semana é o preço, não a comunicação.";
  }
  if (dimension === "avaliacao") {
    return "Por que isso importa: o que atacar esta semana é a avaliação, não um guia.";
  }
  if (dimension === "tamanho") {
    return "Por que isso importa: o que atacar esta semana é o tamanho ou a dose, não um artigo.";
  }
  if (dimension === "embalagem") {
    return "Por que isso importa: o que atacar esta semana é a embalagem, não a comunicação.";
  }
  return "Por que isso importa: o que atacar esta semana é a fórmula, não um artigo no site.";
}

function resolveMove(input: ProductBriefInput): {
  move: ProductMove;
  dimension: ProductLosingDimension;
} {
  if (input.confidence === "empty") {
    return { move: "esperar_followup", dimension: null };
  }
  if (input.confidence === "store_only" || input.followupReason === "missing_product") {
    return { move: "esperar_followup", dimension: null };
  }
  if (input.followupReason === "missing_seller" || input.followupReason === "missing_facts") {
    return { move: "esperar_followup", dimension: null };
  }
  if (input.confidence === "split") {
    return { move: "aceitar_gap", dimension: null };
  }
  if (input.move) {
    return { move: input.move, dimension: input.losingDimension ?? null };
  }
  return {
    move: "aceitar_gap",
    dimension: input.losingDimension ?? "composicao",
  };
}

export function formulateTrackProdutoFirstAction(input: ProductBriefInput): ProductBrief {
  const sku = input.skuName.trim() || "este produto";
  const useAttrs = clean(input.useAttrs);
  const skipAttrs = clean(input.skipAttrs);
  const { move, dimension } = resolveMove(input);
  const crowned = input.crownedName?.trim() || null;
  const url = input.productUrl?.trim() || null;
  const store = input.storeHint?.trim() || input.crownedSeller?.trim() || null;

  let first_action: string;
  let support_line: string;
  let theme: string;
  const skip = skipFact(skipAttrs);
  let chipSkip: string[] = [];
  const extra = extraWeight(input.contributions);
  const contributions = input.contributions ?? [];

  if (input.confidence === "store_only") {
    theme = store ? `loja ${store} sem produto` : "loja sem produto";
    first_action = join([
      store ? `A IA citou a loja ${store}, sem produto.` : "A IA citou uma loja, sem produto.",
      "Ainda não dá para comparar preço, prazo nem fórmula.",
      "Esta semana: não mude o produto. O próximo diagnóstico pergunta qual produto.",
    ]);
    support_line = "Por que isso importa: loja sem produto não é um concorrente.";
  } else if (input.followupReason === "missing_seller") {
    theme = crowned ? `${crowned} sem loja` : "produto recomendado sem loja";
    first_action = join([
      crowned
        ? `A IA recomendou ${crowned}, mas a loja não veio nesta leitura.`
        : "A IA recomendou um produto, mas a loja não veio nesta leitura.",
      "Ainda não dá para dizer se o problema é preço, prazo ou fórmula.",
      "Esta semana: não mude o produto. O próximo diagnóstico fecha quem vende.",
    ]);
    support_line = "Por que isso importa: sem loja, ainda não dá para comparar a oferta completa.";
  } else if (input.followupReason === "missing_facts") {
    theme = crowned ? `${crowned} com fatos em branco` : "fatos em branco";
    first_action = join([
      crowned
        ? `A IA recomendou ${crowned}, mas preço, prazo ou avaliação não vieram nesta leitura.`
        : "A IA recomendou um produto, mas preço, prazo ou avaliação não vieram nesta leitura.",
      "Ainda não dá para dizer o que atacar.",
      "Esta semana: não baixe o preço nem mude a fórmula com o fato em branco.",
    ]);
    support_line =
      "Por que isso importa: um buraco na leitura não é prova de que o produto perdeu.";
  } else if (input.confidence === "split") {
    theme = "empate de ofertas";
    first_action = join([
      "A IA não escolheu um produto claro neste diagnóstico.",
      "Ainda não dá para dizer se o problema é preço, prazo ou fórmula.",
      "Esta semana: não mude o produto e não trate um só concorrente como o vencedor.",
    ]);
    support_line = "Por que isso importa: empate não autoriza a frase “o concorrente é X”.";
  } else if (move === "esperar_followup") {
    theme = store ? `loja ${store} sem produto` : "oferta incompleta";
    first_action = join([
      store
        ? `A IA citou a loja ${store}, sem produto.`
        : crowned
          ? `A IA recomendou ${crowned}, mas a oferta ainda está incompleta.`
          : "A IA ainda não fechou um produto para comparar.",
      "Ainda não dá para dizer se o problema é preço, prazo ou fórmula.",
      "Esta semana: não mude o produto.",
    ]);
    support_line = "Por que isso importa: sem oferta completa, o Rint não aponta o que atacar.";
  } else if (!dimension) {
    theme = "oferta sem fato comparável";
    first_action = join([
      whoLine(crowned, sku),
      "Nesta leitura não deu para apontar preço, prova nem fórmula.",
      "Esta semana: não mude o produto.",
    ]);
    support_line = "Por que isso importa: sem um fato comparável, o Rint não inventa o que atacar.";
  } else {
    theme =
      move === "mudar_preco"
        ? "preço da oferta"
        : dimension === "avaliacao"
          ? "prova e avaliação"
          : dimension === "tamanho"
            ? "tamanho da oferta"
            : dimension === "embalagem"
              ? "embalagem da oferta"
              : "composição da oferta";
    first_action = join([
      whoLine(crowned, sku),
      lostOnLine(dimension, skip, input.priceClient, input.priceCrowned, extra),
      weekLine(move, dimension, skip, sku),
    ]);
    support_line = whyLine(dimension);
    chipSkip = dimension === "composicao" ? glassSkipAttrs(skipAttrs) : [];
  }

  return {
    theme,
    sku_name: sku,
    brand: input.brand,
    first_action,
    support_line,
    move,
    surface: "sku_da_loja",
    target_url: url,
    losing_dimension: dimension,
    crowned_name: crowned,
    crowned_seller: input.crownedSeller,
    price_client: input.priceClient,
    price_crowned: input.priceCrowned,
    use_attrs: useAttrs,
    skip_attrs: chipSkip,
    followup_reason: input.followupReason,
    contributions,
  };
}
