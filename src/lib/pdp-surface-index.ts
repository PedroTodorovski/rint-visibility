/**
 * Derived PDP index from a pontual public GET. Never persist HTML.
 * Contract: rint-app/docs/PDP-SURFACE-INDEX.md
 */

import type { QueryCitationSplit } from "./shopper-question-kind.js";

export type PdpSurfaceIndex = {
  documentTitle: string | null;
  ogTitle: string | null;
  h1: string | null;
  lede: string | null;
  metaDescription: string | null;
  faqQuestionCount: number;
  hasFaqPage: boolean;
  hasVideo: boolean;
  hasVideoObject: boolean;
  shippingOnPage: boolean;
  shippingInJsonLd: boolean;
  shippingText: string | null;
  hasPrice: boolean;
  hasRating: boolean;
  ratingText: string | null;
  hasGtin: boolean;
  hasBreadcrumb: boolean;
  hasBrand: boolean;
  hasOgImage: boolean;
  hasCompareText: boolean;
};

export type WeekWorkWhere = "shopify" | "page";

export type WeekWorkItem = {
  id: string;
  where: WeekWorkWhere;
  do: string;
  from?: string | null;
  to?: string | null;
};

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
  "the",
  "and",
]);

export function foldPdpText(value: string): string {
  return value
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

function tokens(value: string): string[] {
  return foldPdpText(value)
    .split(" ")
    .filter((token) => token.length >= 4 && !STOP.has(token));
}

function decodeEntities(value: string): string {
  return value
    .replace(/&amp;/g, "&")
    .replace(/&quot;/g, '"')
    .replace(/&#39;|&apos;/g, "'")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&#(\d+);/g, (_, code) => String.fromCharCode(Number(code)));
}

function metaContent(html: string, property: string): string | null {
  const escaped = property.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const re = new RegExp(
    `<meta[^>]+(?:property|name)=["']${escaped}["'][^>]+content=["']([^"']+)["']`,
    "i",
  );
  const alt = new RegExp(
    `<meta[^>]+content=["']([^"']+)["'][^>]+(?:property|name)=["']${escaped}["']`,
    "i",
  );
  const raw = html.match(re)?.[1] || html.match(alt)?.[1];
  const text = raw ? decodeEntities(raw).replace(/\s+/g, " ").trim() : "";
  return text || null;
}

function tagInnerText(html: string, tag: string): string | null {
  const match = html.match(new RegExp(`<${tag}\\b[^>]*>([\\s\\S]*?)</${tag}>`, "i"));
  if (!match?.[1]) return null;
  const text = decodeEntities(match[1].replace(/<[^>]+>/g, " "))
    .replace(/\s+/g, " ")
    .trim();
  return text || null;
}

function jsonLdNodes(html: string): Record<string, unknown>[] {
  const nodes: Record<string, unknown>[] = [];
  const scripts = html.matchAll(
    /<script[^>]+type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi,
  );
  const walk = (value: unknown) => {
    if (Array.isArray(value)) {
      for (const item of value) walk(item);
      return;
    }
    if (!value || typeof value !== "object") return;
    const record = value as Record<string, unknown>;
    nodes.push(record);
    if (record["@graph"]) walk(record["@graph"]);
    for (const nested of Object.values(record)) {
      if (nested && typeof nested === "object") walk(nested);
    }
  };
  for (const script of scripts) {
    const raw = script[1]?.trim();
    if (!raw) continue;
    try {
      walk(JSON.parse(raw));
    } catch {
      /* ignore broken JSON-LD */
    }
  }
  return nodes;
}

function typeList(value: unknown): string[] {
  if (typeof value === "string") return [value];
  if (Array.isArray(value)) return value.filter((item): item is string => typeof item === "string");
  return [];
}

function hasType(node: Record<string, unknown>, leaf: string): boolean {
  const needle = leaf.toLowerCase();
  return typeList(node["@type"]).some((type) => {
    const cleaned = type.toLowerCase();
    return cleaned === needle || cleaned.endsWith(`/${needle}`) || cleaned.endsWith(`:${needle}`);
  });
}

function textValue(value: unknown): string | null {
  if (typeof value === "string" && value.trim()) return value.replace(/\s+/g, " ").trim();
  if (value && typeof value === "object" && "name" in (value as object)) {
    return textValue((value as { name?: unknown }).name);
  }
  return null;
}

function visiblePageText(html: string): string {
  const stripped = html
    .replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, " ")
    .replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi, " ")
    .replace(/<[^>]+>/g, " ");
  return decodeEntities(stripped).replace(/\s+/g, " ");
}

function tidyPhrase(value: string): string {
  const phrase = value.replace(/\s+/g, " ").trim();
  if (!phrase) return phrase;
  return phrase.charAt(0).toUpperCase() + phrase.slice(1);
}

/** Visible “Frete grátis…”, never a JSON dump of collections. */
export function humanShippingPhrase(html: string): string | null {
  const visible = visiblePageText(html);
  const gratis = visible.match(/frete\s+gr[aá]tis(?:\s+acima\s+de\s+R\$\s*[\d.,]+)?/i);
  return gratis ? tidyPhrase(gratis[0]) : null;
}

function shippingWorkDo(phrase: string | null): string {
  if (phrase) {
    return `A página já mostra ${phrase}. O cliente já vê. Falta a IA ver o mesmo nos dados de envio deste produto.`;
  }
  return "A página já mostra o frete. O cliente já vê. Falta a IA ver o mesmo nos dados de envio deste produto.";
}

function faqWorkDo(count: number): string {
  if (count === 1) {
    return "A pergunta já aparece na página. Falta a IA enxergar essa lista — cadastre-a em Perguntas frequentes.";
  }
  if (count > 1) {
    return `As ${count} perguntas já aparecem na página. Falta a IA enxergar essa lista — cadastre as mesmas perguntas em Perguntas frequentes.`;
  }
  return "As perguntas já aparecem na página. Falta a IA enxergar essa lista — cadastre-as em Perguntas frequentes.";
}

/** Rewrite a persisted queue line so old jobs speak the same Portuguese. */
export function founderFacingWorkItem(item: WeekWorkItem): WeekWorkItem {
  return { ...item, do: founderFacingWorkDo(item) };
}

function founderFacingWorkDo(item: WeekWorkItem): string {
  switch (item.id) {
    case "search_title":
      return "No Shopify deste produto, troque o meta title.";
    case "faq_schema": {
      const count = Number(item.do.match(/(\d+)\s+perguntas?/)?.[1] ?? 0);
      return faqWorkDo(count);
    }
    case "shipping_schema": {
      const dumped = /","/.test(item.do) || /[{[]/.test(item.do);
      const gratis = item.do.match(/frete\s+gr[aá]tis(?:\s+acima\s+de\s+R\$\s*[\d.,]+)?/i);
      return shippingWorkDo(!dumped && gratis ? tidyPhrase(gratis[0]) : null);
    }
    case "video_schema":
      return "Os vídeos já aparecem na página. Falta a IA saber que eles existem — cadastre-os como vídeo deste produto.";
    case "gtin":
      return "No Shopify deste produto, cadastre o código de barras (GTIN).";
    case "breadcrumb":
      return "Inclua a migalha de navegação (Início > categoria > produto), para a IA entender onde este produto fica na loja.";
    case "improve_editorial":
      return "Melhore o texto desta página para quem busca sem o nome da loja.";
    case "price_brand":
      return "Deixe preço e marca iguais à loja neste cadastro e nesta página do produto.";
    case "blog_index":
      return "Crie um conteúdo neste blog para quem busca sem o nome da loja. Não invente outro endereço.";
    default:
      return item.do;
  }
}

export function founderFacingAlreadyOk(chips: string[]): string[] {
  return chips.map((chip) => {
    if (chip === "Título grande") return "Título na página";
    if (chip === "Texto de baixo") return "Texto de apresentação";
    return chip.replace(/na tela$/i, "na página");
  });
}

export function indexPdpHtml(html: string): PdpSurfaceIndex {
  const nodes = jsonLdNodes(html);
  const documentTitle = tagInnerText(html, "title");
  const ogTitle = metaContent(html, "og:title");
  const h1 = tagInnerText(html, "h1");
  const jsonDescription = nodes.map((node) => textValue(node.description)).find(Boolean) ?? null;
  const lede =
    jsonDescription || metaContent(html, "og:description") || metaContent(html, "description");
  const faqHeads = [
    ...html.matchAll(/<h[23]\b[^>]*>([\s\S]*?)<\/h[23]>/gi),
    ...html.matchAll(/<summary\b[^>]*>([\s\S]*?)<\/summary>/gi),
  ].map((match) =>
    decodeEntities(match[1].replace(/<[^>]+>/g, " "))
      .replace(/\s+/g, " ")
      .trim(),
  );
  const faqQuestionCount = faqHeads.filter((head) => head.includes("?")).length;
  const visible = visiblePageText(html);
  const shippingText = humanShippingPhrase(html);
  const ratingNode = nodes.find((node) => node.aggregateRating);
  const aggregate = ratingNode?.aggregateRating as Record<string, unknown> | undefined;
  const ratingValue = textValue(aggregate?.ratingValue);
  const ratingCount = textValue(aggregate?.reviewCount ?? aggregate?.ratingCount);
  const ratingText = ratingValue && ratingCount ? `${ratingValue} / ${ratingCount}` : ratingValue;
  const hasGtin = nodes.some((node) =>
    Boolean(node.gtin || node.gtin13 || node.gtin12 || node.gtin8 || node.gtin14),
  );
  const hasPrice = nodes.some((node) => {
    const offers = node.offers;
    if (offers && typeof offers === "object") {
      const offer = Array.isArray(offers) ? offers[0] : offers;
      if (offer && typeof offer === "object" && "price" in offer) return true;
    }
    return Boolean(node.price);
  });
  const shippingInJsonLd = nodes.some((node) => {
    const blob = JSON.stringify(node);
    return /shippingDetails|shippingRate|OfferShippingDetails/i.test(blob);
  });
  return {
    documentTitle,
    ogTitle,
    h1,
    lede,
    metaDescription: metaContent(html, "description"),
    faqQuestionCount,
    hasFaqPage: nodes.some((node) => hasType(node, "FAQPage") || hasType(node, "Question")),
    hasVideo:
      /<video\b/i.test(html) || /youtube\.com\/embed|youtu\.be\/|player\.vimeo\.com/i.test(html),
    hasVideoObject: nodes.some((node) => hasType(node, "VideoObject")),
    shippingOnPage: /\bfrete\b/i.test(visible),
    shippingInJsonLd,
    shippingText,
    hasPrice: hasPrice || Boolean(metaContent(html, "product:price:amount")),
    hasRating: Boolean(ratingText) || /\bavalia/i.test(html),
    ratingText,
    hasGtin,
    hasBreadcrumb: nodes.some((node) => hasType(node, "BreadcrumbList")),
    hasBrand: nodes.some((node) => hasType(node, "Brand") || Boolean(node.brand)),
    hasOgImage: Boolean(metaContent(html, "og:image")),
    hasCompareText: /comparativ|\bx\b.+\bdoses\b|versus|\bvs\b/i.test(html),
  };
}

export function isPdpReady(input: {
  storefrontAccess?: string | null;
  catalogFirst: boolean;
  split: QueryCitationSplit | null;
}): boolean {
  if (input.catalogFirst) return false;
  if (input.storefrontAccess !== "open") return false;
  if (!input.split || input.split.namedTotal === 0) return false;
  return input.split.namedCited === input.split.namedTotal;
}

function searchTitleBlob(index: PdpSurfaceIndex): string {
  return [index.documentTitle, index.ogTitle].filter(Boolean).join(" ");
}

function proposeSearchTitle(index: PdpSurfaceIndex, brand: string | null): string | null {
  const h1Lead = (index.h1 ?? "").split("|")[0]?.trim() || "";
  if (!h1Lead) return null;
  const brandBit = brand?.trim() || "";
  if (brandBit && !foldPdpText(h1Lead).includes(foldPdpText(brandBit))) {
    return `${h1Lead} | ${brandBit}`;
  }
  return h1Lead;
}

export function buildPdpWorkItems(input: {
  index: PdpSurfaceIndex;
  brand: string | null;
  lostQueryTexts: string[];
}): WeekWorkItem[] {
  const items: WeekWorkItem[] = [];
  const lostBlob = input.lostQueryTexts.join(" ");
  const headNeedles = [
    ...tokens(input.index.h1 ?? ""),
    ...tokens(input.index.lede ?? ""),
    ...tokens(lostBlob),
  ];
  const titleFold = foldPdpText(searchTitleBlob(input.index));
  const missingInTitle = [...new Set(headNeedles)].filter(
    (token) => token.length >= 5 && !titleFold.includes(token),
  );
  const fromTitle = input.index.documentTitle || input.index.ogTitle;
  const toTitle = proposeSearchTitle(input.index, input.brand);
  if (
    fromTitle &&
    toTitle &&
    missingInTitle.length > 0 &&
    foldPdpText(fromTitle) !== foldPdpText(toTitle)
  ) {
    items.push({
      id: "search_title",
      where: "shopify",
      do: "No Shopify deste produto, troque o meta title.",
      from: fromTitle,
      to: toTitle,
    });
  }
  if (input.index.faqQuestionCount > 0 && !input.index.hasFaqPage) {
    items.push({
      id: "faq_schema",
      where: "page",
      do: faqWorkDo(input.index.faqQuestionCount),
    });
  }
  if (input.index.shippingOnPage && !input.index.shippingInJsonLd) {
    items.push({
      id: "shipping_schema",
      where: "page",
      do: shippingWorkDo(input.index.shippingText),
    });
  }
  if (input.index.hasVideo && !input.index.hasVideoObject) {
    items.push({
      id: "video_schema",
      where: "page",
      do: "Os vídeos já aparecem na página. Falta a IA saber que eles existem — cadastre-os como vídeo deste produto.",
    });
  }
  if (!input.index.hasGtin) {
    items.push({
      id: "gtin",
      where: "shopify",
      do: "No Shopify deste produto, cadastre o código de barras (GTIN).",
    });
  }
  if (!input.index.hasBreadcrumb) {
    items.push({
      id: "breadcrumb",
      where: "page",
      do: "Inclua a migalha de navegação (Início > categoria > produto), para a IA entender onde este produto fica na loja.",
    });
  }
  return items;
}

export function buildAlreadyOk(index: PdpSurfaceIndex): string[] {
  const out: string[] = [];
  if (index.h1) out.push("Título na página");
  if (index.lede) out.push("Texto de apresentação");
  if (index.hasPrice) out.push("Preço");
  if (index.shippingOnPage) out.push("Frete");
  if (index.faqQuestionCount > 0) {
    out.push(
      index.faqQuestionCount === 1
        ? "1 pergunta na página"
        : `${index.faqQuestionCount} perguntas na página`,
    );
  }
  if (index.hasRating) {
    out.push(index.ratingText ? `Avaliação ${index.ratingText}` : "Avaliação");
  }
  if (index.hasCompareText) out.push("Comparativo");
  return out;
}

export function editorialWorkItem(): WeekWorkItem {
  return {
    id: "improve_editorial",
    where: "page",
    do: "Melhore o texto desta página para quem busca sem o nome da loja.",
  };
}

export function priceBrandWorkItem(): WeekWorkItem {
  return {
    id: "price_brand",
    where: "shopify",
    do: "Deixe preço e marca iguais à loja neste cadastro e nesta página do produto.",
  };
}

export function blogIndexWorkItem(): WeekWorkItem {
  return {
    id: "blog_index",
    where: "page",
    do: "Crie um conteúdo neste blog para quem busca sem o nome da loja. Não invente outro endereço.",
  };
}
