import { describe, expect, it } from "vitest";

import {
  collectCitedPdpUrls,
  groundingUrlsForCitedObject,
  isEditorialMediaUrl,
  pickCitedImageFromHtml,
  pickOfferReader,
  refuseCitedOffer,
  resolveCitedOfferImage,
  resolveCitedOfferPage,
  stampCitedImage,
  stampCitedShopperFacts,
} from "../src/lib/cited-offer-image.js";
import { emptyShopperOffer } from "../src/lib/shopper-offer.js";

const JSON_LD = `<script type="application/ld+json">${JSON.stringify({
  "@context": "https://schema.org",
  "@type": "Product",
  name: "AG1",
  image: "https://cdn.drinkag1.com/ag1.jpg",
})}</script>`;

const OG = `<meta property="og:image" content="https://cdn.example/og.jpg">`;
const TWITTER = `<meta name="twitter:image" content="https://cdn.example/tw.jpg">`;

describe("pickCitedImageFromHtml", () => {
  it("prefers JSON-LD Product.image over Open Graph", () => {
    const html = `${JSON_LD}${OG}${TWITTER}`;
    expect(pickCitedImageFromHtml(html, "https://drinkag1.com/products/ag1")).toEqual({
      url: "https://cdn.drinkag1.com/ag1.jpg",
      layer: "json_ld",
    });
  });

  it("falls back to og:image when structured data has no photo", () => {
    expect(pickCitedImageFromHtml(OG + TWITTER, "https://drinkag1.com/products/ag1")).toEqual({
      url: "https://cdn.example/og.jpg",
      layer: "og",
    });
  });

  it("does not use twitter:image as a checkout photo", () => {
    expect(pickCitedImageFromHtml(TWITTER, "https://drinkag1.com/products/ag1")).toBeNull();
  });

  it("does not invent a CDN path from empty HTML", () => {
    expect(pickCitedImageFromHtml("<html></html>", "https://drinkag1.com/products/ag1")).toBeNull();
  });
});

describe("resolveCitedOfferImage", () => {
  it("does not treat a Gemini https URL as the checkout photo", async () => {
    await expect(
      resolveCitedOfferImage({
        imagemUrl: "https://media.post.rvohealth.io/ag1.jpg",
        productUrl: "https://drinkag1.com/blog/ag1",
      }),
    ).resolves.toBeNull();
  });

  it("rejects a guessed non-https path", async () => {
    await expect(resolveCitedOfferImage({ imagemUrl: "/static/ag1.jpg" })).resolves.toBeNull();
  });
});

describe("stampCitedImage", () => {
  it("fills null on the crowned SKU only and never overwrites a first-turn URL", () => {
    const objects = stampCitedImage(
      [
        { marca: "Athletic Greens", produto: "AG1", imagem_url: null },
        { marca: "Bloom", produto: "Greens", imagem_url: null },
        { marca: "Athletic Greens", produto: "AG1", imagem_url: "https://cdn.example/kept.jpg" },
      ],
      "athletic greens|ag1",
      "https://cdn.example/new.jpg",
    );
    expect(objects[0]?.imagem_url).toBe("https://cdn.example/new.jpg");
    expect(objects[1]?.imagem_url).toBeNull();
    expect(objects[2]?.imagem_url).toBe("https://cdn.example/kept.jpg");
  });

  it("replaces a blog asset so the next JSON-LD photo can land", () => {
    const objects = stampCitedImage(
      [
        {
          marca: "Centrum",
          produto: "Centrum Bariátrico",
          imagem_url: "https://beltnutrition.com.br/media/mageplaza/blog/post/x.jpg",
        },
      ],
      "centrum|centrum bariatrico",
      "https://cdn.example/pdp.jpg",
    );
    expect(objects[0]?.imagem_url).toBe("https://cdn.example/pdp.jpg");
  });

  it("replaces a truncated VTEX path so the API jpg can land", () => {
    const truncated =
      "https://paguemenos.vteximg.com.br/arquivos/ids/1005995/Multivitaminico-Bariatrico---30-Cap";
    const objects = stampCitedImage(
      [{ marca: "Flora Nativa", produto: "Multivitamínico Bariátrico", imagem_url: truncated }],
      "flora nativa|multivitaminico bariatrico",
      "https://paguemenos.vteximg.com.br/arquivos/ids/1005995/KIT-2X-Flora-Nativa.jpg",
    );
    expect(objects[0]?.imagem_url).toContain(".jpg");
  });
});

describe("stampCitedShopperFacts", () => {
  it("fills price and rating only when Gemini left them empty", () => {
    const objects = stampCitedShopperFacts(
      [
        {
          marca: "Centrum",
          produto: "Centrum Bariátrico",
          preco: null,
          avaliacao: null,
          url: null,
          atributos: [],
        },
        { marca: "Biostévi", produto: "Nutrition", preco: null, url: null, atributos: [] },
        {
          marca: "Centrum",
          produto: "Centrum Bariátrico",
          preco: 71,
          avaliacao: "4,9",
          url: null,
          atributos: [],
        },
      ],
      "centrum|centrum bariatrico",
      {
        preco: 89.9,
        moeda: "BRL",
        avaliacao: "4.8 (23)",
        prazo_entrega: null,
        dimensoes: null,
        qualidade: null,
        atributos: ["Avaliação: 4.8 (23)", "Garantia: 3 meses"],
        url: "https://www.drogariasaopaulo.com.br/centrum-bariatrico/p",
      },
    );
    expect(objects[0]?.preco).toBe(89.9);
    expect(objects[0]?.avaliacao).toBe("4.8 (23)");
    expect(objects[0]?.atributos).toEqual(
      expect.arrayContaining(["Avaliação: 4.8 (23)", "Garantia: 3 meses"]),
    );
    expect(objects[1]?.preco).toBeNull();
    expect(objects[2]?.preco).toBe(71);
    expect(objects[2]?.avaliacao).toBe("4,9");
    expect(objects[0]?.url).toBe("https://www.drogariasaopaulo.com.br/centrum-bariatrico/p");
  });

  it("replaces a Google redirect and a quality slogan", () => {
    const objects = stampCitedShopperFacts(
      [
        {
          marca: "Flora Nativa",
          produto: "Multivitamínico Bariátrico",
          url: "https://vertexaisearch.cloud.google.com/grounding-api-redirect/abc",
          qualidade: "bom custo-benefício",
        },
      ],
      "flora nativa|multivitaminico bariatrico",
      {
        preco: 39.9,
        moeda: "BRL",
        avaliacao: null,
        prazo_entrega: null,
        dimensoes: "30 cápsulas",
        qualidade: "Anvisa notificado",
        atributos: [],
        url: "https://www.paguemenos.com.br/kit-flora/p",
      },
    );
    expect(objects[0]?.url).toBe("https://www.paguemenos.com.br/kit-flora/p");
    expect(objects[0]?.qualidade).toBe("Anvisa notificado");
  });

  it("does not keep a Gemini slogan when the PDP has no cert", () => {
    const objects = stampCitedShopperFacts(
      [
        {
          marca: "Centrum",
          produto: "Centrum Bariátrico",
          qualidade: "bom custo-benefício",
        },
      ],
      "centrum|centrum bariatrico",
      {
        preco: null,
        moeda: null,
        avaliacao: null,
        prazo_entrega: null,
        dimensoes: null,
        qualidade: null,
        atributos: [],
        url: null,
      },
    );
    expect(objects[0]?.qualidade).toBeNull();
  });

  it("replaces blog price and rating when the checkout page was actually read", () => {
    const objects = stampCitedShopperFacts(
      [
        {
          marca: "Nutrify",
          produto: "Multi All",
          preco: 100,
          avaliacao: "4.9 (752 opiniões)",
          prazo_entrega: null,
          url: null,
        },
      ],
      "nutrify|multi all",
      {
        preco: 89.9,
        moeda: "BRL",
        avaliacao: "4.8 (12)",
        prazo_entrega: "Frete grátis",
        dimensoes: null,
        qualidade: null,
        atributos: ["Minerais quelados"],
        url: "https://www.drogasil.com.br/nutrify-multi-all-60-capsulas.html",
      },
      { fromCheckout: true },
    );
    expect(objects[0]?.preco).toBe(89.9);
    expect(objects[0]?.avaliacao).toBe("4.8 (12)");
    expect(objects[0]?.prazo_entrega).toBe("Frete grátis");
    expect(objects[0]?.url).toContain("drogasil.com.br");
  });

  it("drops a login-wall URL when the checkout was not read", () => {
    const objects = stampCitedShopperFacts(
      [
        {
          marca: "Lavitan",
          produto: "Lavitan AZ Mulher",
          url: "https://www.mercadolivre.com.br/gz/account-verification?go=https://lista.mercadolivre.com.br/lavitan",
        },
      ],
      "lavitan|lavitan az mulher",
      {
        preco: null,
        moeda: null,
        avaliacao: null,
        prazo_entrega: null,
        dimensoes: null,
        qualidade: null,
        atributos: [],
        url: null,
      },
      { dropUrl: true },
    );
    expect(objects[0]?.url).toBeNull();
  });
});

describe("isEditorialMediaUrl", () => {
  it("refuses Magento blog media and keeps a product CDN", () => {
    expect(
      isEditorialMediaUrl("https://beltnutrition.com.br/media/mageplaza/blog/post/x.jpg"),
    ).toBe(true);
    expect(isEditorialMediaUrl("https://cdn.shopify.com/s/files/1/p.jpg")).toBe(false);
  });
});

describe("pickOfferReader / refuseCitedOffer", () => {
  it("picks Mercado Livre and VTEX by the resolved URL, HTML otherwise", () => {
    expect(pickOfferReader("https://produto.mercadolivre.com.br/MLB-123456789-centrum").id).toBe(
      "mercado_livre",
    );
    expect(pickOfferReader("https://www.drogariasaopaulo.com.br/centrum-bariatrico/p").id).toBe(
      "vtex",
    );
    expect(pickOfferReader("https://www.amazon.com.br/dp/B0EXAMPLE").id).toBe("html");
  });

  it("refuses a home and an identity mismatch", () => {
    expect(refuseCitedOffer("https://loja.com/", emptyShopperOffer(), null)).toBe(true);
    expect(
      refuseCitedOffer(
        "https://www.amazon.com.br/dp/B0BLOOM",
        {
          ...emptyShopperOffer(),
          name: "Bloom Greens",
          pageUrl: "https://www.amazon.com.br/dp/B0BLOOM",
        },
        { marca: "Centrum", produto: "Centrum Bariátrico" },
      ),
    ).toBe(true);
  });
});

describe("groundingUrlsForCitedObject", () => {
  it("does not leak one rival's grounding onto another", () => {
    const urls = [
      "https://www.drogariasaopaulo.com.br/centrum-bariatrico/p",
      "https://produto.mercadolivre.com.br/MLB-999-prolj-bariatric",
    ];
    expect(
      groundingUrlsForCitedObject(urls, { marca: "Centrum", produto: "Centrum Bariátrico" }),
    ).toEqual(["https://www.drogariasaopaulo.com.br/centrum-bariatrico/p"]);
  });

  it("keeps a Google redirect until the final URL can be matched", () => {
    const google = "https://vertexaisearch.cloud.google.com/grounding-api-redirect/abc";
    expect(
      groundingUrlsForCitedObject(
        [google, "https://produto.mercadolivre.com.br/MLB-999-prolj-bariatric"],
        { marca: "Centrum", produto: "Centrum Bariátrico" },
      ),
    ).toEqual([google]);
  });

  it("prefers a fitted PDP over a pile of Google redirects", () => {
    const google = "https://vertexaisearch.cloud.google.com/grounding-api-redirect/abc";
    const pdp = "https://www.paguemenos.com.br/multivitaminico-bariatrico-flora-nativa/p";
    expect(
      groundingUrlsForCitedObject([google, pdp], {
        marca: "Flora Nativa",
        produto: "Multivitamínico Bariátrico",
      }),
    ).toEqual([pdp]);
  });
});

describe("resolveCitedOfferPage", () => {
  const pdp = "https://www.drogariasaopaulo.com.br/centrum-bariatrico/p";
  const html = `<!doctype html><html><head><script type="application/ld+json">${JSON.stringify({
    "@context": "https://schema.org",
    "@type": "Product",
    name: "Centrum Bariátrico",
    image: "https://cdn.example/centrum.jpg",
    offers: { price: "89.90", priceCurrency: "BRL" },
    aggregateRating: { ratingValue: "4.8", reviewCount: "12" },
  })}</script></head><body><h1>Centrum Bariátrico</h1></body></html>`;

  const ogOnly = `<!doctype html><html><head>
    <meta property="og:title" content="Centrum Bariátrico">
    <meta property="og:image" content="https://cdn.example/og.jpg">
    <meta property="product:price:amount" content="89.90">
    <meta property="product:price:currency" content="BRL">
  </head><body><h1>Centrum Bariátrico</h1>
  <p>${"Ficha do produto na vitrine. ".repeat(20)}</p>
  </body></html>`;

  function mockFetch(pages: Record<string, string>): typeof fetch {
    return async (input) => {
      const href = String(input);
      const resolved = href.includes("vertexaisearch") ? pdp : href;
      const body = pages[resolved] ?? (resolved === pdp ? html : "");
      const json = href.includes("/api/catalog_system/") || href.includes("api.mercadolivre.com");
      const res = new Response(json ? "[]" : body, {
        status: 200,
        headers: { "content-type": json ? "application/json" : "text/html" },
      });
      Object.defineProperty(res, "url", { value: json ? href : resolved });
      return res;
    };
  }

  it("reads price and rating from Product JSON-LD on a pharmacy PDP", async () => {
    const page = await resolveCitedOfferPage({
      productUrl: pdp,
      cited: { marca: "Centrum", produto: "Centrum Bariátrico" },
      fetchImpl: mockFetch({}),
    });
    expect(page.facts.preco).toBe(89.9);
    expect(page.facts.avaliacao).toBe("4.8 (12)");
    expect(page.facts.url).toBe(pdp);
    expect(page.pageUrl).toBe(pdp);
    expect(page.image?.url).toBe("https://cdn.example/centrum.jpg");
  });

  it("accepts Open Graph photo and price when JSON-LD is absent", async () => {
    const seen: string[] = [];
    const page = await resolveCitedOfferPage({
      productUrl: pdp,
      cited: { marca: "Centrum", produto: "Centrum Bariátrico" },
      fetchImpl: async (input) => {
        const href = String(input);
        seen.push(href);
        return mockFetch({ [pdp]: ogOnly })(input);
      },
    });
    expect(seen.some((href) => href === pdp)).toBe(true);
    expect(page.offer).toEqual(
      expect.objectContaining({
        name: expect.stringMatching(/Centrum/),
        price: 89.9,
        imageUrl: "https://cdn.example/og.jpg",
      }),
    );
  });

  it("resolves a Google redirect before the PDP GET", async () => {
    const page = await resolveCitedOfferPage({
      productUrl: "https://vertexaisearch.cloud.google.com/grounding-api-redirect/abc",
      cited: { marca: "Centrum", produto: "Centrum Bariátrico" },
      fetchImpl: mockFetch({}),
    });
    expect(page.pageUrl).toBe(pdp);
    expect(page.facts.preco).toBe(89.9);
  });

  it("does not treat a blog grounding page as the product and ignores editorial Gemini photos", async () => {
    const page = await resolveCitedOfferPage({
      imagemUrl: "https://beltnutrition.com.br/media/mageplaza/blog/post/x.jpg",
      productUrl: "https://beltnutrition.com.br/blog/centrum",
      groundingUrls: ["https://beltnutrition.com.br/blog/centrum"],
      fetchImpl: mockFetch({}),
    });
    expect(page.image).toBeNull();
    expect(page.facts.preco).toBeNull();
    expect(page.pageUrl).toBeNull();
  });

  it("refuses a home after redirect and an identity mismatch", async () => {
    const home = "https://www.drogariasaopaulo.com.br/";
    const bloom = `<script type="application/ld+json">${JSON.stringify({
      "@type": "Product",
      name: "Bloom Greens",
      image: "https://cdn.example/bloom.jpg",
      offers: { price: "10", priceCurrency: "USD" },
    })}</script>`;
    const mismatch = await resolveCitedOfferPage({
      productUrl: "https://www.amazon.com.br/dp/B0BLOOM",
      cited: { marca: "Centrum", produto: "Centrum Bariátrico" },
      fetchImpl: async (input) => {
        const href = String(input);
        const res = new Response(href.includes("amazon") ? bloom : "", {
          status: 200,
          headers: { "content-type": "text/html" },
        });
        Object.defineProperty(res, "url", { value: href });
        return res;
      },
    });
    expect(mismatch.facts.preco).toBeNull();

    const closed = await resolveCitedOfferPage({
      productUrl: "https://vertexaisearch.cloud.google.com/grounding-api-redirect/home",
      fetchImpl: async () => {
        const res = new Response("<html><h1>Home</h1></html>", { status: 200 });
        Object.defineProperty(res, "url", { value: home });
        return res;
      },
    });
    expect(closed.pageUrl).toBeNull();
  });

  it("does not fetch a guessed VTEX slug that is not a /p pathname", async () => {
    const seen: string[] = [];
    await collectCitedPdpUrls({
      productUrl: "https://www.drogariasaopaulo.com.br/centrum-bariatrico",
      fetchImpl: async (input) => {
        seen.push(String(input));
        return new Response("", { status: 200 });
      },
    });
    expect(seen.some((href) => href.includes("catalog_system"))).toBe(false);
  });

  it("keeps an already-resolved /p even when Google redirects come first", async () => {
    const pdp = "https://www.paguemenos.com.br/multivitaminico-bariatrico-flora-nativa/p";
    const googles = Array.from(
      { length: 20 },
      (_, i) => `https://vertexaisearch.cloud.google.com/grounding-api-redirect/${i}`,
    );
    let googleFetches = 0;
    const urls = await collectCitedPdpUrls({
      groundingUrls: [...googles, pdp],
      cited: { marca: "Flora Nativa", produto: "Multivitamínico Bariátrico" },
      fetchImpl: async (input) => {
        const href = String(input);
        if (href.includes("vertexaisearch")) googleFetches += 1;
        const res = new Response("", { status: 200 });
        Object.defineProperty(res, "url", { value: href });
        return res;
      },
    });
    expect(urls).toContain(pdp);
    expect(urls[0]).toBe(pdp);
    expect(googleFetches).toBe(0);
  });

  it("fills VTEX price then HTML rating on the same /p URL", async () => {
    const vtexJson = JSON.stringify([
      {
        productName: "Centrum Bariátrico",
        items: [
          {
            images: [{ imageUrl: "https://cdn.example/vtex.jpg" }],
            sellers: [{ commertialOffer: { Price: 71.9 } }],
          },
        ],
      },
    ]);
    const page = await resolveCitedOfferPage({
      productUrl: pdp,
      cited: { marca: "Centrum", produto: "Centrum Bariátrico" },
      fetchImpl: async (input) => {
        const href = String(input);
        if (href.includes("/api/catalog_system/")) {
          return new Response(vtexJson, {
            status: 200,
            headers: { "content-type": "application/json" },
          });
        }
        return mockFetch({})(input);
      },
    });
    expect(page.facts.preco).toBe(71.9);
    expect(page.facts.avaliacao).toBe("4.8 (12)");
    expect(page.image?.url).toBe("https://cdn.example/vtex.jpg");
  });

  it("does not mix Extrafarma rating into the Pague Menos checkout", async () => {
    const pague = "https://www.paguemenos.com.br/multivitaminico-bariatrico-flora-nativa/p";
    const extra = "https://www.extrafarma.com.br/multivitaminico-bariatrico-flora-nativa/p";
    const vtexJson = JSON.stringify([
      {
        productName: "Multivitamínico Bariátrico Flora Nativa",
        items: [
          {
            images: [{ imageUrl: "https://cdn.example/flora.jpg" }],
            sellers: [{ commertialOffer: { Price: 39.9 } }],
          },
        ],
      },
    ]);
    const rated = `<!doctype html><html><head><script type="application/ld+json">${JSON.stringify({
      "@context": "https://schema.org",
      "@type": "Product",
      name: "Flora Nativa Multivitamínico Bariátrico",
      image: "https://cdn.example/flora.jpg",
      aggregateRating: { ratingValue: "4.6", reviewCount: "8" },
    })}</script></head><body><h1>Flora Nativa</h1></body></html>`;
    const seen: string[] = [];
    const page = await resolveCitedOfferPage({
      productUrl: pague,
      groundingUrls: [extra],
      cited: { marca: "Flora Nativa", produto: "Multivitamínico Bariátrico" },
      seller: "Pague Menos",
      fetchImpl: async (input) => {
        const href = String(input);
        seen.push(href);
        if (href.includes("/api/catalog_system/")) {
          const res = new Response(href.includes("extrafarma") ? "[]" : vtexJson, {
            status: 200,
            headers: { "content-type": "application/json" },
          });
          Object.defineProperty(res, "url", { value: href });
          return res;
        }
        const body = href.includes("extrafarma") ? rated : "<html></html>";
        const res = new Response(body, {
          status: 200,
          headers: { "content-type": "text/html" },
        });
        Object.defineProperty(res, "url", { value: href.includes("extrafarma") ? extra : pague });
        return res;
      },
    });
    expect(page.facts.preco).toBe(39.9);
    expect(page.facts.avaliacao).toBeNull();
    expect(page.facts.url).toBe(pague);
    expect(
      seen.some((href) => href.includes("extrafarma") && href.includes("catalog_system")),
    ).toBe(false);
  });
});
