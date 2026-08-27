import { describe, expect, it } from "vitest";
import { parsePublicPdpHtml } from "../src/lib/pdp-identity.js";
import {
  emptyShopperOffer,
  groundingFitsCited,
  isCompleteProductImageUrl,
  isProductImageUrl,
  isSearchThumbnailUrl,
  mergeShopperOffer,
  offerMatchesCited,
  shopperOfferFromIdentity,
  shopperOfferHasFact,
  shopperOfferNeedsHtmlEnrichment,
} from "../src/lib/shopper-offer.js";

describe("isProductImageUrl", () => {
  it("keeps a checkout CDN and refuses search thumbs and blog media", () => {
    expect(isProductImageUrl("https://cdn.shopify.com/s/files/1/p.jpg")).toBe(true);
    expect(
      isCompleteProductImageUrl(
        "https://paguemenos.vteximg.com.br/arquivos/ids/1005995/Multivitaminico-Bariatrico---30-Cap",
      ),
    ).toBe(false);
    expect(isCompleteProductImageUrl("https://cdn.shopify.com/s/files/1/p")).toBe(true);
    expect(isCompleteProductImageUrl("https://cdn.example/flora.jpg")).toBe(true);
    expect(isSearchThumbnailUrl("https://encrypted-tbn0.gstatic.com/images?q=ag1")).toBe(true);
    expect(isProductImageUrl("https://encrypted-tbn0.gstatic.com/images?q=ag1")).toBe(false);
    expect(isProductImageUrl("https://beltnutrition.com.br/media/mageplaza/blog/post/x.jpg")).toBe(
      false,
    );
    expect(
      isProductImageUrl("https://media.post.rvohealth.io/wp-content/uploads/2023/08/ag1.jpg"),
    ).toBe(false);
  });
});

describe("offerMatchesCited", () => {
  it("accepts a short SKU in the page name or URL", () => {
    expect(
      offerMatchesCited(
        { name: "AG1", url: "https://drinkag1.com/products/ag1" },
        { marca: "Athletic Greens", produto: "AG1" },
      ),
    ).toBe(true);
  });

  it("refuses a structured name that is not this SKU", () => {
    expect(
      offerMatchesCited(
        { name: "Bloom Greens", url: "https://www.amazon.com.br/dp/B0BLOOM" },
        { marca: "Centrum", produto: "Centrum Bariátrico" },
      ),
    ).toBe(false);
  });
});

describe("groundingFitsCited", () => {
  it("does not apply a rival host to another SKU", () => {
    expect(
      groundingFitsCited(
        "https://www.drogariasaopaulo.com.br/centrum-bariatrico/p",
        "Centrum Bariátrico",
        { marca: "PROLJ", produto: "Prolj Bariatric" },
      ),
    ).toBe(false);
  });
});

describe("shopperOfferFromIdentity", () => {
  it("maps Open Graph price and photo when JSON-LD is absent", () => {
    const identity = parsePublicPdpHtml(
      `<meta property="og:title" content="Centrum Bariátrico">
       <meta property="og:image" content="https://cdn.example/og.jpg">
       <meta property="product:price:amount" content="89.90">
       <meta property="product:price:currency" content="BRL">`,
      "https://www.drogariasaopaulo.com.br/centrum-bariatrico/p",
    );
    const offer = shopperOfferFromIdentity(
      identity,
      "https://www.drogariasaopaulo.com.br/centrum-bariatrico/p",
      "drogariasaopaulo.com.br",
    );
    expect(offer.imageUrl).toBe("https://cdn.example/og.jpg");
    expect(offer.price).toBe(89.9);
    expect(offer.currency).toBe("BRL");
    expect(shopperOfferHasFact(offer)).toBe(true);
  });

  it("starts empty", () => {
    expect(shopperOfferHasFact(emptyShopperOffer())).toBe(false);
  });
});

describe("mergeShopperOffer", () => {
  it("keeps platform price and fills HTML rating", () => {
    const vtex = {
      ...emptyShopperOffer(),
      name: "Centrum Bariátrico",
      price: 71.9,
      imageUrl: "https://cdn.example/vtex.jpg",
    };
    const html = {
      ...emptyShopperOffer(),
      name: "Centrum Bariátrico",
      price: 89.9,
      rating: "4.8 (12)",
      shipping: "Frete grátis",
      imageUrl: "https://cdn.example/html.jpg",
    };
    const merged = mergeShopperOffer(vtex, html);
    expect(merged.price).toBe(71.9);
    expect(merged.imageUrl).toBe("https://cdn.example/vtex.jpg");
    expect(merged.rating).toBe("4.8 (12)");
    expect(merged.shipping).toBe("Frete grátis");
    expect(shopperOfferNeedsHtmlEnrichment(vtex)).toBe(true);
    expect(shopperOfferNeedsHtmlEnrichment(merged)).toBe(false);
  });
});
