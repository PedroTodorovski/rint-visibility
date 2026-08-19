import { describe, expect, it } from "vitest";
import type { ProductRow, PromptRow } from "../src/repositories/types.js";
import {
  groupQueriesByProduct,
  isLikelyPdpUrl,
  productsForDiagnosis,
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
