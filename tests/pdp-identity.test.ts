import { describe, expect, it } from "vitest";

import {
  classifyStorefrontAccess,
  detectStorefrontPlatform,
  isBlockedStorefrontHtml,
  isPasswordStorefrontHtml,
  parsePublicPdpHtml,
} from "../src/lib/pdp-identity.js";

describe("parsePublicPdpHtml", () => {
  it("reads JSON-LD Product name, price and attributes", () => {
    const identity = parsePublicPdpHtml(`
      <script type="application/ld+json">
        {"@type":"Product","name":"Sofá-cama Flowin","brand":{"name":"Inflow"},
         "offers":{"price":"4200","priceCurrency":"BRL"},
         "material":"linho","additionalProperty":[{"name":"Largura","value":"220 cm"}]}
      </script>
    `);
    expect(identity.hasJsonLd).toBe(true);
    expect(identity.name).toBe("Sofá-cama Flowin");
    expect(identity.brand).toBe("Inflow");
    expect(identity.currentPrice).toBe(4200);
    expect(identity.currency).toBe("BRL");
    expect(identity.attributes).toEqual(expect.arrayContaining(["linho", "Largura: 220 cm"]));
  });

  it("prefers JSON-LD image over og:image", () => {
    const identity = parsePublicPdpHtml(`
      <meta property="og:image" content="https://cdn.loja.com/og.jpg">
      <script type="application/ld+json">
        {"@type":"Product","name":"Prancha","image":"https://cdn.loja.com/jsonld.jpg"}
      </script>
    `);
    expect(identity.image).toBe("https://cdn.loja.com/jsonld.jpg");
    expect(identity.imageSource).toBe("json_ld");
    expect(identity.hasOg).toBe(true);
  });

  it("falls back to og:image when JSON-LD has no image", () => {
    const identity = parsePublicPdpHtml(
      `<meta property="og:image" content="https://cdn.loja.com/og.jpg"><meta property="og:title" content="Prancha">`,
    );
    expect(identity.image).toBe("https://cdn.loja.com/og.jpg");
    expect(identity.imageSource).toBe("og");
    expect(identity.hasOg).toBe(true);
  });

  it("prefers og:image:secure_url over og:image", () => {
    const identity = parsePublicPdpHtml(`
      <meta property="og:image" content="http://cdn.loja.com/http.jpg">
      <meta property="og:image:secure_url" content="https://cdn.loja.com/https.jpg">
    `);
    expect(identity.image).toBe("https://cdn.loja.com/https.jpg");
    expect(identity.imageSource).toBe("og");
  });

  it("resolves relative and protocol-relative images against the PDP URL", () => {
    const relative = parsePublicPdpHtml(
      `<meta property="og:image" content="/arquivos/ids/123.jpg">`,
      "https://loja.vtexcommercestable.com.br/prancha/p",
    );
    expect(relative.image).toBe("https://loja.vtexcommercestable.com.br/arquivos/ids/123.jpg");
    expect(relative.imageSource).toBe("og");

    const protocolRelative = parsePublicPdpHtml(
      `<script type="application/ld+json">
        {"@type":"Product","name":"Jaqueta","image":{"@type":"ImageObject","url":"//d26lpennugtm8s.cloudfront.net/stores/001/jacket.jpg"}}
      </script>`,
      "https://loja.nuvemshop.com.br/produtos/jaqueta",
    );
    expect(protocolRelative.image).toBe(
      "https://d26lpennugtm8s.cloudfront.net/stores/001/jacket.jpg",
    );
    expect(protocolRelative.imageSource).toBe("json_ld");
  });

  it("reads a VTEX-shaped JSON-LD Product image array", () => {
    const identity = parsePublicPdpHtml(`
      <script type="application/ld+json">
        {"@type":"Product","name":"Tênis VTEX","image":["https://loja.vteximg.com.br/arquivos/ids/1/tenis.jpg"]}
      </script>
    `);
    expect(identity.image).toBe("https://loja.vteximg.com.br/arquivos/ids/1/tenis.jpg");
    expect(identity.imageSource).toBe("json_ld");
  });

  it("fills diagnosis identity from Open Graph product tags when JSON-LD is absent", () => {
    const identity = parsePublicPdpHtml(`
      <meta property="og:title" content="Tênis Run">
      <meta property="product:brand" content="Olympikus">
      <meta property="product:price:amount" content="1.299,90">
      <meta property="product:price:currency" content="BRL">
      <meta property="product:category" content="Calçados">
      <meta property="og:image" content="https://loja.vteximg.com.br/tenis.jpg">
    `);
    expect(identity.hasOg).toBe(true);
    expect(identity.name).toBe("Tênis Run");
    expect(identity.brand).toBe("Olympikus");
    expect(identity.currentPrice).toBe(1299.9);
    expect(identity.currency).toBe("BRL");
    expect(identity.attributes).toContain("Calçados");
    expect(identity.imageSource).toBe("og");
  });

  it("reads VTEX JSON-LD name, brand, offer and specs used in triage", () => {
    const identity = parsePublicPdpHtml(`
      <script type="application/ld+json">
        {"@graph":[{"@type":"Product","name":"Tênis VTEX","brand":"Olympikus",
         "color":"preto","material":"mesh",
         "offers":{"@type":"Offer","price":"349.00","priceCurrency":"BRL"},
         "additionalProperty":[{"name":"Largura","value":"40"}]}]}
      </script>
    `);
    expect(identity.hasJsonLd).toBe(true);
    expect(identity.name).toBe("Tênis VTEX");
    expect(identity.brand).toBe("Olympikus");
    expect(identity.currentPrice).toBe(349);
    expect(identity.currency).toBe("BRL");
    expect(identity.color).toBe("preto");
    expect(identity.material).toBe("mesh");
    expect(identity.dimension).toBe("40");
    expect(identity.attributes).toEqual(expect.arrayContaining(["preto", "mesh", "Largura: 40"]));
  });

  it("falls back to og:title then title when JSON-LD is absent", () => {
    const og = parsePublicPdpHtml(
      `<meta property="og:title" content="Flowin Sofa"><meta property="product:price:amount" content="1999">`,
    );
    expect(og.hasOg).toBe(true);
    expect(og.name).toBe("Flowin Sofa");
    expect(og.currentPrice).toBe(1999);

    const title = parsePublicPdpHtml(`<title>Sofá modular</title><h1>Outro</h1>`);
    expect(title.name).toBe("Sofá modular");
  });

  it("accepts schema.org URL @type and ProductGroup with trailing commas", () => {
    const urlType = parsePublicPdpHtml(`
      <script type="application/ld+json">
        {"@type":"https://schema.org/Product","name":"Prancha URL",
         "offers":{"price":"100","priceCurrency":"BRL"},}
      </script>
    `);
    expect(urlType.hasJsonLd).toBe(true);
    expect(urlType.name).toBe("Prancha URL");
    expect(urlType.currentPrice).toBe(100);

    const group = parsePublicPdpHtml(`
      <script type='application/ld+json'>
        {"@type":"ProductGroup","name":"Jaqueta Grupo",
         "hasVariant":[{"@type":"Product","name":"Jaqueta M","offers":{"price":"250","priceCurrency":"BRL"}}]}
      </script>
    `);
    expect(group.hasJsonLd).toBe(true);
    expect(group.name).toBe("Jaqueta M");
    expect(group.currentPrice).toBe(250);
  });

  it("reads Product inside ItemList and concatenated JSON-LD scripts", () => {
    const listed = parsePublicPdpHtml(`
      <script type="application/ld+json">
        {"@type":"ItemList","itemListElement":[{"@type":"Product","name":"Lista SKU","offers":{"price":"10","priceCurrency":"BRL"}}]}
      </script>
    `);
    expect(listed.hasJsonLd).toBe(true);
    expect(listed.name).toBe("Lista SKU");

    const concat = parsePublicPdpHtml(`
      <script type="application/ld+json">
        {"@type":"BreadcrumbList","itemListElement":[]}
        {"@type":"Product","name":"Concat SKU","offers":{"price":"20","priceCurrency":"BRL"}}
      </script>
    `);
    expect(concat.hasJsonLd).toBe(true);
    expect(concat.name).toBe("Concat SKU");
  });

  it("treats schema.org Product microdata as structured data present", () => {
    const identity = parsePublicPdpHtml(`
      <div itemscope itemtype="https://schema.org/Product">
        <span itemprop="name">Microdata SKU</span>
      </div>
    `);
    expect(identity.hasJsonLd).toBe(true);
  });

  it("flags password walls so callers do not claim schema absent", () => {
    expect(
      isBlockedStorefrontHtml(
        `<html><body><form action="/password"><input name="password"></form></body></html>`,
        "https://loja.myshopify.com/password",
      ),
    ).toBe(true);
    expect(
      isPasswordStorefrontHtml(
        `<html><body><form action="/password"><input name="password"></form></body></html>`,
        "https://loja.myshopify.com/password",
      ),
    ).toBe(true);
    expect(
      classifyStorefrontAccess({
        alive: true,
        html: `<html><body><form action="/password"><input name="password"></form></body></html>`,
        finalUrl: "https://loja.myshopify.com/password",
      }),
    ).toBe("password");
    expect(
      classifyStorefrontAccess({
        alive: false,
        status: 403,
        html: null,
        finalUrl: "https://vtex.example/p/sku",
      }),
    ).toBe("blocked");
    expect(
      isPasswordStorefrontHtml(
        `<html><body><p>This shop is password protected</p></body></html>`,
        "https://brand.example/products/x",
      ),
    ).toBe(true);
  });
});

describe("detectStorefrontPlatform", () => {
  it("trusts Shopify / VTEX / Nuvemshop hosts before HTML", () => {
    expect(
      detectStorefrontPlatform({
        url: "https://rint-test-store.myshopify.com/products/the-complete-snowboard",
        html: null,
      }),
    ).toBe("shopify");
    expect(
      detectStorefrontPlatform({
        url: "https://loja.vtexcommercestable.com.br/prancha/p",
        html: null,
      }),
    ).toBe("vtex");
    expect(
      detectStorefrontPlatform({
        url: "https://loja.nuvemshop.com.br/produtos/jaqueta",
        html: null,
      }),
    ).toBe("nuvemshop");
  });

  it("reads JSON-LD and HTML fingerprints on a custom domain", () => {
    expect(
      detectStorefrontPlatform({
        url: "https://marca.com.br/products/prancha",
        html: `<script type="application/ld+json">{"@type":"Product","image":"https://cdn.shopify.com/s/files/1.jpg"}</script>`,
      }),
    ).toBe("shopify");
    expect(
      detectStorefrontPlatform({
        url: "https://marca.com.br/prancha/p",
        html: `<meta name="generator" content="VTEX IO"><img src="https://marca.vteximg.com.br/arquivos/ids/1.jpg">`,
      }),
    ).toBe("vtex");
    expect(
      detectStorefrontPlatform({
        url: "https://marca.com.br/produtos/jaqueta",
        html: `<script type="application/ld+json">{"@type":"Product","name":"Jaqueta","image":"https://cdn.nuvemshop.com.br/stores/001/jacket.jpg"}</script>`,
      }),
    ).toBe("nuvemshop");
  });

  it("does not invent a platform from a generic PDP", () => {
    expect(
      detectStorefrontPlatform({
        url: "https://marca.com.br/products/prancha",
        html: `<script type="application/ld+json">{"@type":"Product","name":"Prancha"}</script>`,
      }),
    ).toBeNull();
  });
});
