import { describe, expect, it } from "vitest";

import {
  pickCitedImageFromHtml,
  resolveCitedOfferImage,
  stampCitedImage,
} from "../src/lib/cited-offer-image.js";

const JSON_LD = `<script type="application/ld+json">${JSON.stringify({
  "@context": "https://schema.org",
  "@type": "Product",
  name: "AG1",
  image: "https://cdn.drinkag1.com/ag1.jpg",
})}</script>`;

const OG = `<meta property="og:image" content="https://cdn.example/og.jpg">`;
const TWITTER = `<meta name="twitter:image" content="https://cdn.example/tw.jpg">`;

describe("pickCitedImageFromHtml", () => {
  it("prefers JSON-LD Product.image over Open Graph and Twitter", () => {
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

  it("falls back to twitter:image when JSON-LD and OG are absent", () => {
    expect(pickCitedImageFromHtml(TWITTER, "https://drinkag1.com/products/ag1")).toEqual({
      url: "https://cdn.example/tw.jpg",
      layer: "twitter",
    });
  });

  it("does not invent a CDN path from empty HTML", () => {
    expect(pickCitedImageFromHtml("<html></html>", "https://drinkag1.com/products/ag1")).toBeNull();
  });
});

describe("resolveCitedOfferImage", () => {
  it("uses Gemini imagem_url when it is already an https image", async () => {
    await expect(
      resolveCitedOfferImage({
        imagemUrl: "https://media.post.rvohealth.io/ag1.jpg",
        productUrl: "https://drinkag1.com/products/ag1",
      }),
    ).resolves.toEqual({
      url: "https://media.post.rvohealth.io/ag1.jpg",
      layer: "gemini",
    });
  });

  it("rejects a guessed non-https path", async () => {
    await expect(
      resolveCitedOfferImage({ imagemUrl: "/static/ag1.jpg" }),
    ).resolves.toBeNull();
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
});
