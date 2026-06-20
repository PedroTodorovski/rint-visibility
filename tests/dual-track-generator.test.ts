import { describe, expect, it } from "vitest";

import { generateDualTracks } from "../src/services/dual-track-generator.js";
import { computeRevenueGap } from "../src/services/revenue-gap-engine.js";

describe("generateDualTracks", () => {
  it("always includes track 1 and track 2 per SKU", () => {
    const gap = computeRevenueGap({
      receitaAiMedida: 4500,
      citationClient: 2,
      citationTotal: 10,
      citationCompetitor: 5,
      ticketMedio: 450,
      cacSku: 135,
    });

    const products = [
      {
        id: "sku-1",
        store_id: "store-1",
        url: "https://shop.example/hero",
        title: "Runner Pro",
        description: null,
        external_ref: "gid://shopify/Product/1",
        position: 1,
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      },
    ];

    const output = generateDualTracks(products, gap, [
      {
        cited: false,
        metadata: {
          competitors: [{ name: "nike.com", url: "https://nike.com/x", type: "domain" }],
        },
      },
    ]);

    expect(output.tracks.length).toBe(1);
    expect(output.tracks[0]!.track1.length).toBeGreaterThan(0);
    expect(output.tracks[0]!.track2.length).toBeGreaterThan(0);
    expect(output.triageOwner).toBe("narrative");
  });
});
