import { describe, expect, it } from "vitest";

import {
  crownCompetitorSku,
  groundingHostsFromUrls,
  mergeFollowUpCitedObjects,
  planCitedOfferFollowUp,
  productIdentityKey,
  sellerFromObject,
} from "../src/lib/cited-offer.js";

const client = {
  name: "Nuture Daily Boost",
  brand: "Nuture",
  url: "https://nuture.com.br/products/nuture-daily-boost",
};

const ag1 = {
  marca: "Athletic Greens",
  produto: "AG1",
  loja: "Athletic Greens",
  url: "https://drinkag1.com/products/ag1",
  preco: 99,
  moeda: "USD",
  prazo_entrega: "5 a 8 dias",
  avaliacao: "4.8",
  atributos: ["75 vitamins"],
};

describe("cited offer crown", () => {
  it("crowns a SKU on strict majority when N >= 2", () => {
    const crown = crownCompetitorSku({
      client,
      objectsByQuery: [[ag1], [ag1], [{ marca: "Bloom", produto: "Greens", loja: "Amazon" }]],
    });
    expect(crown.confidence).toBe("clear");
    expect(crown.produto).toBe("AG1");
    expect(crown.seller).toBe("Athletic Greens");
    expect(crown.persistedCount).toBe(3);
  });

  it("does not crown a split and keeps both SKUs", () => {
    const crown = crownCompetitorSku({
      client,
      objectsByQuery: [[ag1], [{ marca: "Bloom", produto: "Greens", loja: "Amazon" }]],
    });
    expect(crown.confidence).toBe("split");
    expect(crown.produto).toBeNull();
    expect(crown.candidates).toHaveLength(2);
  });

  it("does not treat a store-only name as a winner", () => {
    const crown = crownCompetitorSku({
      client,
      objectsByQuery: [
        [{ loja: "Decathlon" }],
        [{ loja: "Decathlon" }],
        [{ loja: "Decathlon" }],
        [{ loja: "Decathlon" }],
      ],
    });
    expect(crown.confidence).toBe("store_only");
    expect(crown.produto).toBeNull();
    expect(crown.seller).toBe("Decathlon");
    expect(planCitedOfferFollowUp(crown)?.reason).toBe("missing_product");
  });

  it("does not mix two products from the same store into one profile", () => {
    const crown = crownCompetitorSku({
      client,
      objectsByQuery: [
        [{ marca: "Burton", produto: "Custom Flying V", loja: "Decathlon", preco: 1899 }],
        [{ marca: "Burton", produto: "Custom Flying V", loja: "Decathlon" }],
        [{ marca: "Salomon", produto: "Sight", loja: "Decathlon", preco: 999 }],
      ],
    });
    expect(crown.confidence).toBe("clear");
    expect(crown.produto).toBe("Custom Flying V");
    expect(crown.preco).toBe(1899);
  });

  it("skips follow-up when criticals are already filled", () => {
    const crown = crownCompetitorSku({
      client,
      objectsByQuery: [[ag1], [ag1]],
    });
    expect(planCitedOfferFollowUp(crown)).toBeNull();
  });

  it("does not treat a review host as the seller", () => {
    expect(
      sellerFromObject({
        marca: "Athletic Greens",
        produto: "AG1",
        url: "https://www.healthline.com/nutrition/athletic-greens-review",
      }),
    ).toBeNull();
    expect(
      groundingHostsFromUrls(
        [
          "https://www.healthline.com/nutrition/athletic-greens-review",
          "https://drinkag1.com/products/ag1",
        ],
        "drinkag1.com",
      ).map((row) => row.host),
    ).toEqual(["healthline.com"]);
  });

  it("keys identity as marca+produto", () => {
    expect(productIdentityKey(ag1)).toBe("athletic greens|ag1");
  });

  it("follow-up fills nulls only and keeps every cited SKU", () => {
    const merged = mergeFollowUpCitedObjects(
      [
        { marca: "Athletic Greens", produto: "AG1", preco: 99, loja: null },
        { marca: "Bloom", produto: "Greens", preco: 189 },
      ],
      [{ marca: "Athletic Greens", produto: "AG1", preco: 1, loja: "Athletic Greens" }],
    );
    expect(merged).toHaveLength(2);
    expect(merged[0]?.preco).toBe(99);
    expect(merged[0]?.loja).toBe("Athletic Greens");
  });
});
