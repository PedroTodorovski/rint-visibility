/**
 * `track_pdp` week action — one frank move on this URL’s technical door.
 * Contract: rint-app/docs/DIAGNOSIS-DOMINANT.md (`next_steps.page_brief`).
 * Preview twin: rint-app/src/lib/diagnosis-pdp-first-action.ts
 * Never paste `query_text`. Never a SEO laundry list. No second Gemini.
 */

import type { PageMove, StorefrontAccess } from "./pdp-week-judge.js";

export type PageSurface = "url_medida" | "integracoes";
export type PageSource = "painel" | "rua" | "nao_lemos";

export type PageBriefInput = {
  skuName: string;
  brand: string | null;
  productUrl: string | null;
  move: PageMove | undefined;
  access: StorefrontAccess | null;
  hasJsonLd: boolean | null;
  shopifyConnected: boolean;
  panelMismatch: boolean;
  shopDomain?: string | null;
};

export type PageBrief = {
  theme: string;
  sku_name: string;
  brand: string | null;
  move: PageMove;
  surface: PageSurface;
  target_url: string | null;
  access: StorefrontAccess | null;
  has_json_ld: boolean | null;
  source: PageSource;
  shop_domain: string | null;
  panel_mismatch: boolean;
  first_action: string;
  support_line: string;
};

function hrefLabel(url: string | null): string {
  if (!url?.trim()) return "esta URL";
  try {
    const parsed = new URL(url);
    const host = parsed.host.replace(/^www\./, "");
    const path = parsed.pathname.replace(/\/$/, "");
    return `${host}${path}`;
  } catch {
    return url;
  }
}

function skuLabel(name: string): string {
  return name.trim() || "este produto";
}

export function formulateTrackPdpFirstAction(input: PageBriefInput): PageBrief | null {
  if (!input.move) return null;
  const sku = skuLabel(input.skuName);
  const path = hrefLabel(input.productUrl);
  const shopDomain = input.shopDomain?.trim() || null;

  if (input.move === "abrir_senha") {
    return {
      theme: "porta_publica",
      sku_name: sku,
      brand: input.brand,
      move: input.move,
      surface: "url_medida",
      target_url: input.productUrl,
      access: input.access,
      has_json_ld: null,
      source: "nao_lemos",
      shop_domain: shopDomain,
      panel_mismatch: false,
      first_action: `Esta URL está com senha. Sem a porta aberta, a IA não lê o ${sku}. Esta semana: tire a senha da página do produto.`,
      support_line: "Por que isso importa: a IA lê o que um visitante anônimo lê.",
    };
  }

  if (input.move === "tirar_bloqueio") {
    return {
      theme: "porta_publica",
      sku_name: sku,
      brand: input.brand,
      move: input.move,
      surface: "url_medida",
      target_url: input.productUrl,
      access: input.access,
      has_json_ld: null,
      source: "nao_lemos",
      shop_domain: shopDomain,
      panel_mismatch: false,
      first_action: `O acesso público a esta URL foi recusado. Sem a porta aberta, a IA não lê o ${sku}. Esta semana: tire o bloqueio da página do produto.`,
      support_line: "Por que isso importa: a IA lê o que um visitante anônimo lê.",
    };
  }

  if (input.move === "conferir_publico") {
    return {
      theme: "porta_publica",
      sku_name: sku,
      brand: input.brand,
      move: input.move,
      surface: "url_medida",
      target_url: input.productUrl,
      access: input.access,
      has_json_ld: null,
      source: "nao_lemos",
      shop_domain: shopDomain,
      panel_mismatch: false,
      first_action:
        "Não conseguimos ler a página pública deste produto. Por isso não afirmamos se a ficha estruturada está lá. Esta semana: confira se a loja está pública.",
      support_line:
        "Por que isso importa: sem GET público, schema numa página fechada seria mentira.",
    };
  }

  if (input.move === "ligar_loja_da_url") {
    return {
      theme: "loja_da_url",
      sku_name: sku,
      brand: input.brand,
      move: input.move,
      surface: "integracoes",
      target_url: "/integrations",
      access: input.access,
      has_json_ld: input.hasJsonLd,
      source: "rua",
      shop_domain: shopDomain,
      panel_mismatch: true,
      first_action:
        "Esta URL não está no Shopify que você ligou. Lemos a página pública. Não usamos o cadastro nesta leitura. Esta semana: em Integrações, ligue a loja que é desta URL.",
      support_line: "Por que isso importa: o diagnóstico usou a rua, não o Admin desta loja.",
    };
  }

  const cadastro = input.shopifyConnected ? "O cadastro no Shopify já tem o produto. " : "";
  return {
    theme: "ficha_na_rua",
    sku_name: sku,
    brand: input.brand,
    move: "expor_schema",
    surface: "url_medida",
    target_url: input.productUrl,
    access: input.access,
    has_json_ld: false,
    source: "rua",
    shop_domain: shopDomain,
    panel_mismatch: false,
    first_action: `${cadastro}A página pública não expõe a ficha estruturada. Esta semana: exponha essa ficha em ${path}.`,
    support_line: "Por que isso importa: o cadastro no painel não é a página pública.",
  };
}
