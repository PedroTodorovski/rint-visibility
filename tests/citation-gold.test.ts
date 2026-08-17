import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

import { scoreClientCitation } from "../src/lib/citation-gold.js";

const IDENTITY = {
  storeName: "rint-test-store",
  domain: "rint-test-store.myshopify.com",
  productUrl: "https://rint-test-store.myshopify.com/products/the-multi-location-snowboard",
  productName: "The Multi-location Snowboard",
};

describe("scoreClientCitation", () => {
  it("does not treat a negative mention as a client citation", () => {
    const evidence = scoreClientCitation({
      text: 'É importante notar que o produto "The Multi-location Snowboard" da rint-test-store.myshopify.com não foi encontrado nas buscas por pranchas de snowboard baratas no Brasil.',
      identity: IDENTITY,
      resolved: [
        {
          from: "https://vertexaisearch.cloud.google.com/grounding-api-redirect/abc",
          to: "https://www.decathlon.com.br/snowboard",
          host: "decathlon.com.br",
        },
      ],
      llmClaimedCited: true,
    });
    expect(evidence.cited).toBe(false);
    expect(evidence.why).toBe("negative_mention");
    expect(evidence.negative_mention).toBe(true);
    expect(evidence.llm_claimed_cited).toBe(true);
  });

  it("ignores prompt echo in the answer unless the client host is in resolved grounding", () => {
    const evidence = scoreClientCitation({
      text: "Você pode encontrar a prancha **The Multi-location Snowboard** na loja online rint-test-store.myshopify.com.",
      identity: IDENTITY,
      resolved: [
        {
          from: "https://vertexaisearch.cloud.google.com/grounding-api-redirect/abc",
          to: "https://www.decathlon.com.br/prancha",
          host: "decathlon.com.br",
        },
      ],
      llmClaimedCited: true,
    });
    expect(evidence.cited).toBe(false);
    expect(evidence.why).toBe("text_only_not_grounded");
  });

  it("cites only when a resolved grounding host is the client store", () => {
    const evidence = scoreClientCitation({
      text: "The Multi-location Snowboard is available at rint-test-store.myshopify.com.",
      identity: IDENTITY,
      resolved: [
        {
          from: "https://vertexaisearch.cloud.google.com/grounding-api-redirect/abc",
          to: "https://rint-test-store.myshopify.com/products/the-multi-location-snowboard",
          host: "rint-test-store.myshopify.com",
        },
      ],
      llmClaimedCited: false,
    });
    expect(evidence.cited).toBe(true);
    expect(evidence.why).toBe("grounding_host");
    expect(evidence.llm_claimed_cited).toBe(false);
  });
});

describe("diagnostic shopper prompt", () => {
  it("does not put the client store in the first Gemini pass", () => {
    const src = readFileSync(
      path.join(path.dirname(fileURLToPath(import.meta.url)), "../src/lib/llm/gemini.ts"),
      "utf-8",
    );
    expect(src).toContain("Shopper query:");
    expect(src).toContain("Do not invent a store");
    expect(src).not.toContain("Client PDP:");
    expect(src).not.toContain("Client product:");
    expect(src).not.toContain("Client brand/store:");
  });
});
