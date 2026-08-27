import { describe, expect, it } from "vitest";

import {
  mercadoLivreItemId,
  mercadoLivreReader,
  shopperOfferFromMercadoLivreItem,
  shopperOfferFromVtexSearch,
  vtexReader,
  vtexSearchUrl,
} from "../src/lib/cited-offer-adapters.js";

const ML_URL = "https://produto.mercadolivre.com.br/MLB-123456789-centrum-bariatrico";
const VTEX_PDP = "https://www.drogariasaopaulo.com.br/centrum-bariatrico/p";

const ML_ITEM = {
  title: "Centrum Bariátrico 30 cápsulas",
  price: 89.9,
  currency_id: "BRL",
  permalink: "https://www.mercadolivre.com.br/centrum/MLB123456789",
  pictures: [{ secure_url: "https://http2.mlstatic.com/D_NQ_NP_123-O.jpg" }],
  warranty: "Garantia do vendedor: 30 dias",
  shipping: { free_shipping: true },
  attributes: [
    { name: "Marca", value_name: "Centrum" },
    { name: "Certificado", value_name: "Anvisa" },
  ],
};

const VTEX_SEARCH = [
  {
    productName: "Centrum Bariátrico",
    items: [
      {
        images: [{ imageUrl: "https://drogariasaopaulo.vteximg.com.br/arquivos/ids/1.jpg" }],
        sellers: [
          {
            sellerName: "Drogaria São Paulo",
            commertialOffer: { Price: 71.9 },
          },
        ],
      },
    ],
    specifications: [
      { Name: "Garantia", Value: ["3 meses"] },
      { Name: "Dose", Value: ["1 cápsula"] },
    ],
  },
];

describe("mercadoLivreItemId", () => {
  it("reads the item id from a resolved Mercado Livre URL", () => {
    expect(mercadoLivreItemId(ML_URL)).toBe("MLB123456789");
    expect(
      mercadoLivreItemId("https://www.drogariasaopaulo.com.br/centrum-bariatrico/p"),
    ).toBeNull();
  });
});

describe("vtexSearchUrl", () => {
  it("uses the real /p pathname and never invents a handle", () => {
    expect(vtexSearchUrl(VTEX_PDP)).toBe(
      "https://www.drogariasaopaulo.com.br/api/catalog_system/pub/products/search/centrum-bariatrico/p",
    );
    expect(vtexSearchUrl("https://www.drogariasaopaulo.com.br/centrum-bariatrico")).toBeNull();
    expect(vtexSearchUrl("https://drinkag1.com/products/ag1")).toBeNull();
  });
});

describe("shopperOfferFromMercadoLivreItem", () => {
  it("maps the public item+reviews JSON onto ShopperOffer", () => {
    const offer = shopperOfferFromMercadoLivreItem(
      ML_ITEM,
      { rating_average: 4.8, total: 12 },
      ML_URL,
    );
    expect(offer.name).toMatch(/Centrum/);
    expect(offer.price).toBe(89.9);
    expect(offer.currency).toBe("BRL");
    expect(offer.imageUrl).toBe("https://http2.mlstatic.com/D_NQ_NP_123-O.jpg");
    expect(offer.rating).toBe("4.8 (12)");
    expect(offer.shipping).toBe("Frete grátis");
    expect(offer.guarantee).toMatch(/30 dias/);
    expect(offer.quality).toBe("Anvisa");
  });
});

describe("shopperOfferFromVtexSearch", () => {
  it("maps catalog_system search onto the same ShopperOffer fields as HTML", () => {
    const offer = shopperOfferFromVtexSearch(VTEX_SEARCH, VTEX_PDP);
    expect(offer?.name).toBe("Centrum Bariátrico");
    expect(offer?.price).toBe(71.9);
    expect(offer?.imageUrl).toBe("https://drogariasaopaulo.vteximg.com.br/arquivos/ids/1.jpg");
    expect(offer?.guarantee).toBe("3 meses");
    expect(offer?.dose).toBe("1 cápsula");
    expect(offer?.seller).toBe("Drogaria São Paulo");
  });

  it("returns null on an empty search payload", () => {
    expect(shopperOfferFromVtexSearch([], VTEX_PDP)).toBeNull();
  });
});

describe("platform readers", () => {
  it("calls Mercado Livre items+reviews from the id in the URL", async () => {
    const seen: string[] = [];
    const offer = await mercadoLivreReader.read(ML_URL, async (input) => {
      const href = String(input);
      seen.push(href);
      const body = href.includes("/reviews/") ? { rating_average: 4.8, total: 12 } : ML_ITEM;
      return new Response(JSON.stringify(body), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    });
    expect(seen.some((href) => href.endsWith("/items/MLB123456789"))).toBe(true);
    expect(seen.some((href) => href.endsWith("/reviews/item/MLB123456789"))).toBe(true);
    expect(offer.price).toBe(89.9);
  });

  it("does not call VTEX search when the pathname is a guessed slug without /p", async () => {
    const seen: string[] = [];
    expect(vtexReader.canRead("https://www.drogariasaopaulo.com.br/centrum-bariatrico")).toBe(
      false,
    );
    await vtexReader.read(
      "https://www.drogariasaopaulo.com.br/centrum-bariatrico",
      async (input) => {
        seen.push(String(input));
        return new Response("[]", { status: 200 });
      },
    );
    expect(seen).toEqual([]);
  });
});
