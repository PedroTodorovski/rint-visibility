import { afterEach, describe, expect, it, vi } from "vitest";
import type { ProductRow, PromptRow } from "../src/repositories/types.js";
import {
  groupQueriesByProduct,
  isLikelyPdpUrl,
  isMarketplaceProductUrl,
  productsForDiagnosis,
  validateAndSnapshotSku,
} from "../src/services/diagnostic-input.js";

function product(id: string, position: number): ProductRow {
  return {
    id,
    store_id: "store-1",
    url: `https://loja.test/products/${id}`,
    title: id,
    description: null,
    external_ref: null,
    position,
    created_at: "2026-08-18T12:00:00.000Z",
    updated_at: "2026-08-18T12:00:00.000Z",
  };
}

function prompt(productId: string): PromptRow {
  return {
    id: `prompt-${productId}`,
    store_id: "store-1",
    product_id: productId,
    prompt_text: "melhor prancha",
    active: true,
    sort_order: 1,
    created_at: "2026-08-18T12:00:00.000Z",
    updated_at: "2026-08-18T12:00:00.000Z",
  };
}

describe("productsForDiagnosis", () => {
  it("drops leftover catalog SKUs that have no active question", () => {
    const asked = product("asked", 2);
    const leftover = product("leftover", 1);
    const grouped = groupQueriesByProduct([leftover, asked], [prompt("asked")]);
    expect(productsForDiagnosis([leftover, asked], grouped).map((row) => row.id)).toEqual([
      "asked",
    ]);
  });
});

describe("isLikelyPdpUrl", () => {
  it("accepts Shopify, Nuvemshop, VTEX, and a root-slug PDP", () => {
    expect(isLikelyPdpUrl("https://loja.com/products/handle")).toBe(true);
    expect(isLikelyPdpUrl("https://loja.com/produtos/camiseta")).toBe(true);
    expect(isLikelyPdpUrl("https://loja.com/slug/p")).toBe(true);
    expect(isLikelyPdpUrl("https://loja.com/camisa-azul")).toBe(true);
  });

  it("accepts marketplace product pages", () => {
    expect(isLikelyPdpUrl("https://mercadolivre.com.br/item-camisa")).toBe(true);
    expect(isLikelyPdpUrl("https://www.amazon.com.br/dp/B0EXAMPLE")).toBe(true);
  });

  it("rejects YouTube, news, home, blog, and collections", () => {
    expect(isLikelyPdpUrl("https://www.youtube.com/watch?v=abc")).toBe(false);
    expect(isLikelyPdpUrl("https://www.youtube-nocookie.com/embed/abc")).toBe(false);
    expect(isLikelyPdpUrl("https://g1.globo.com/economia/noticia/foo.html")).toBe(false);
    expect(isLikelyPdpUrl("https://loja.com")).toBe(false);
    expect(isLikelyPdpUrl("https://loja.com/")).toBe(false);
    expect(isLikelyPdpUrl("https://loja.com/blog/post")).toBe(false);
    expect(isLikelyPdpUrl("https://loja.com/collections/all")).toBe(false);
    expect(isLikelyPdpUrl("https://loja.com/colecao/verao")).toBe(false);
  });
});

describe("isMarketplaceProductUrl", () => {
  it("accepts Mercado Livre and Amazon product hosts", () => {
    expect(isMarketplaceProductUrl("https://www.mercadolivre.com.br/item-camisa")).toBe(true);
    expect(isMarketplaceProductUrl("https://www.amazon.com.br/dp/B0EXAMPLE")).toBe(true);
    expect(isMarketplaceProductUrl("https://nuture.com.br/products/daily")).toBe(false);
  });
});

describe("validateAndSnapshotSku shop mismatch", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  const row: ProductRow = {
    id: "p1",
    store_id: "store-1",
    url: "https://nuture.com.br/products/nuture-daily-boost",
    title: "Nuture Daily Boost",
    description: null,
    external_ref: "gid://shopify/Product/1",
    position: 1,
    created_at: "2026-08-18T12:00:00.000Z",
    updated_at: "2026-08-18T12:00:00.000Z",
  };

  it("does not abort when Shopify is connected but this product is missing", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(
        async () => new Response("<html><body><h1>Daily Boost</h1></body></html>", { status: 200 }),
      ),
    );
    const snapshot = await validateAndSnapshotSku(
      row,
      {
        getProductSnapshot: async () => null,
      },
      { shopifyConnected: true, shopDomain: "outra-loja.myshopify.com" },
    );
    expect(snapshot.meta.panelMismatch).toBe(true);
    expect(snapshot.meta.shopConnected).toBe(true);
    expect(snapshot.meta.shopDomain).toBe("outra-loja.myshopify.com");
    expect(snapshot.meta.source).toBe("public_pdp");
    expect(snapshot.name).toBe("Nuture Daily Boost");
  });

  it("does not flag marketplace URLs as shop≠URL", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response("<html><body><h1>Item</h1></body></html>", { status: 200 })),
    );
    const snapshot = await validateAndSnapshotSku(
      { ...row, url: "https://www.mercadolivre.com.br/item-camisa" },
      { getProductSnapshot: async () => null },
      { shopifyConnected: true, shopDomain: "nuture-supps.myshopify.com" },
    );
    expect(snapshot.meta.panelMismatch).toBe(false);
    expect(snapshot.meta.source).toBe("public_pdp");
  });
});
