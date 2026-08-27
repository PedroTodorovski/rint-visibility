import { describe, expect, it } from "vitest";
import {
  buildAlreadyOk,
  buildPdpWorkItems,
  founderFacingWorkItem,
  indexPdpHtml,
  isPdpReady,
} from "../src/lib/pdp-surface-index.js";

const BARI_HTML = `
<title>Complete Bari Multi | Multivitamínico Bariátrico</title>
<meta property="og:title" content="Complete Bari Multi | Multivitamínico Bariátrico">
<meta property="og:description" content="Multivitamínico bariátrico com 23 nutrientes.">
<meta property="og:image" content="https://completebari.com.br/multi.jpg">
<h1>Multivitamínico Para Usuários de Caneta ou Bariátrico | 23 Nutrientes</h1>
<p>Frete grátis acima de R$299. Brinde Surpresa. Cupom PRIMEIRA10.</p>
<video class="review"></video>
<h3>Quem usa caneta emagrecedora precisa tomar multivitaminico?</h3>
<h3>O que diferencia o Multi de outros multivitamínicos?</h3>
<h2>Emagrecimento acelerado x Doses Genéricas</h2>
<script type="application/ld+json">
{"@context":"https://schema.org","@type":"Product","name":"Multi","brand":{"@type":"Brand","name":"CompleteBari"},"description":"Para quem usa canetas emagrecedoras ou fez bariátrica.","offers":{"@type":"Offer","price":"129.90","availability":"https://schema.org/InStock"},"aggregateRating":{"@type":"AggregateRating","ratingValue":"5.00","reviewCount":"78"}}
</script>
`;

describe("indexPdpHtml", () => {
  it("reads Bari-like search title, H1, FAQ text, video, shipping, and missing schema", () => {
    const index = indexPdpHtml(BARI_HTML);
    expect(index.documentTitle).toBe("Complete Bari Multi | Multivitamínico Bariátrico");
    expect(index.h1).toMatch(/Caneta/);
    expect(index.faqQuestionCount).toBe(2);
    expect(index.hasFaqPage).toBe(false);
    expect(index.hasVideo).toBe(true);
    expect(index.hasVideoObject).toBe(false);
    expect(index.shippingOnPage).toBe(true);
    expect(index.shippingInJsonLd).toBe(false);
    expect(index.hasGtin).toBe(false);
    expect(index.hasBreadcrumb).toBe(false);
    expect(index.hasRating).toBe(true);
    expect(index.ratingText).toContain("5.00");
    expect(index.hasCompareText).toBe(true);
  });

  it("counts FAQ questions in summary rows, not only h2/h3", () => {
    const index = indexPdpHtml(`
<title>Multi</title>
<summary>Quem usa caneta emagrecedora precisa tomar multivitaminico?</summary>
<script type="application/ld+json">{"@type":"Product","name":"Multi"}</script>
`);
    expect(index.faqQuestionCount).toBe(1);
    expect(index.hasFaqPage).toBe(false);
  });
});

describe("buildPdpWorkItems", () => {
  it("queues search title first, then FAQ, shipping, video, GTIN", () => {
    const items = buildPdpWorkItems({
      index: indexPdpHtml(BARI_HTML),
      brand: "Complete Bari",
      lostQueryTexts: ["melhor multivitamínico para caneta emagrecedora"],
    });
    expect(items.map((item) => item.id)).toEqual([
      "search_title",
      "faq_schema",
      "shipping_schema",
      "video_schema",
      "gtin",
      "breadcrumb",
    ]);
    expect(items[0]?.where).toBe("shopify");
    expect(items[0]?.from).toMatch(/Complete Bari Multi/);
    expect(items[0]?.to).toMatch(/Caneta/);
    expect(items[0]?.to).toMatch(/Complete Bari/);
    expect(items[1]?.do).toMatch(/2 perguntas/);
    expect(items[0]?.do).toContain("meta title");
    expect(items.find((item) => item.id === "shipping_schema")?.do).toMatch(/Frete grátis/i);
    expect(items.find((item) => item.id === "shipping_schema")?.do).not.toContain('","');
  });

  it("does not paste a collection JSON dump as the shipping phrase", () => {
    const html = `
<title>Multi</title>
<p>Compre agora</p>
<script type="application/json">["Frete Grátis","All","Assinatura","Complete Care","Home page"]</script>
`;
    const index = indexPdpHtml(html);
    expect(index.shippingOnPage).toBe(false);
    expect(index.shippingText).toBeNull();
    expect(
      founderFacingWorkItem({
        id: "shipping_schema",
        where: "page",
        do: 'O frete já aparece na oferta (Frete Grátis","All","Assinatura"). Coloque esse frete no código do produto.',
      }).do,
    ).toBe(
      "A página já mostra o frete. O cliente já vê. Falta a IA ver o mesmo nos dados de envio deste produto.",
    );
  });

  it("does not ask to change a search title that already carries the lost words", () => {
    const html = BARI_HTML.replace(
      /Complete Bari Multi \| Multivitamínico Bariátrico/g,
      "Multivitamínico Para Usuários de Caneta ou Bariátrico | Complete Bari",
    );
    const items = buildPdpWorkItems({
      index: indexPdpHtml(html),
      brand: "Complete Bari",
      lostQueryTexts: ["multivitamínico caneta bariátrico"],
    });
    expect(items.some((item) => item.id === "search_title")).toBe(false);
  });
});

describe("buildAlreadyOk", () => {
  it("lists what the GET already saw", () => {
    const labels = buildAlreadyOk(indexPdpHtml(BARI_HTML));
    expect(labels.join(" ")).toMatch(/Título na página/);
    expect(labels.join(" ")).toMatch(/Frete/);
    expect(labels.join(" ")).toMatch(/perguntas/);
  });
});

describe("isPdpReady", () => {
  it("needs an open URL, a usable catalog, and a closed named door", () => {
    expect(
      isPdpReady({
        storefrontAccess: "open",
        catalogFirst: false,
        split: { categoryCited: 1, categoryTotal: 3, namedCited: 2, namedTotal: 2 },
      }),
    ).toBe(true);
    expect(
      isPdpReady({
        storefrontAccess: "open",
        catalogFirst: false,
        split: { categoryCited: 0, categoryTotal: 5, namedCited: 0, namedTotal: 0 },
      }),
    ).toBe(false);
    expect(
      isPdpReady({
        storefrontAccess: "password",
        catalogFirst: false,
        split: { categoryCited: 1, categoryTotal: 3, namedCited: 2, namedTotal: 2 },
      }),
    ).toBe(false);
  });
});
