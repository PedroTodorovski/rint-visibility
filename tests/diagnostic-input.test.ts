import { describe, expect, it } from "vitest";
import type { ProductRow, PromptRow } from "../src/repositories/types.js";
import { groupQueriesByProduct, productsForDiagnosis } from "../src/services/diagnostic-input.js";

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
