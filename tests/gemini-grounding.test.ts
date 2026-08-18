import { describe, expect, it } from "vitest";

import {
  bindGroundingSupports,
  extractGroundingMetadata,
  supportRefsFromSpans,
} from "../src/lib/gemini-grounding.js";

describe("extractGroundingMetadata", () => {
  it("keeps support spans and chunk indices from the first Gemini candidate", () => {
    const grounding = extractGroundingMetadata({
      candidates: [
        {
          groundingMetadata: {
            groundingChunks: [
              {
                web: { uri: "https://nuture.com.br/products/daily-boost", title: "nuture.com.br" },
              },
              { web: { uri: "https://drinkag1.com/ag1", title: "drinkag1.com" } },
            ],
            groundingSupports: [
              {
                segment: {
                  startIndex: 0,
                  endIndex: 42,
                  text: "O Daily Boost aparece no site da Nuture.",
                },
                groundingChunkIndices: [0],
              },
              {
                segment: { text: "  AG1  continua  o  mais  citado.  " },
                groundingChunkIndices: [1, 99],
              },
            ],
          },
        },
      ],
    });

    expect(grounding.chunks).toEqual([
      { uri: "https://nuture.com.br/products/daily-boost", title: "nuture.com.br" },
      { uri: "https://drinkag1.com/ag1", title: "drinkag1.com" },
    ]);
    expect(grounding.supports).toEqual([
      {
        text: "O Daily Boost aparece no site da Nuture.",
        start: 0,
        end: 42,
        chunk_indices: [0],
      },
      {
        text: "AG1 continua o mais citado.",
        start: undefined,
        end: undefined,
        chunk_indices: [1, 99],
      },
    ]);
  });
});

describe("supportRefsFromSpans", () => {
  it("resolves indices against that response's chunks only", () => {
    expect(
      supportRefsFromSpans(
        [
          { text: "Nuture.", chunk_indices: [0] },
          { text: "AG1.", chunk_indices: [1, 2] },
        ],
        [{ uri: "https://nuture.com.br/" }, { uri: "https://drinkag1.com/" }],
      ),
    ).toEqual([
      { text: "Nuture.", uris: ["https://nuture.com.br/"] },
      { text: "AG1.", uris: ["https://drinkag1.com/"] },
    ]);
  });
});

describe("bindGroundingSupports", () => {
  it("maps first-pass URIs onto resolved shopper hosts", () => {
    expect(
      bindGroundingSupports(
        [
          {
            text: "O Daily Boost aparece no site da Nuture.",
            uris: ["https://vertexaisearch.cloud.google.com/grounding-api-redirect/x"],
          },
        ],
        [
          {
            from: "https://vertexaisearch.cloud.google.com/grounding-api-redirect/x",
            to: "https://nuture.com.br/products/nuture-daily-boost",
            host: "nuture.com.br",
          },
        ],
      ),
    ).toEqual([
      {
        text: "O Daily Boost aparece no site da Nuture.",
        hosts: ["nuture.com.br"],
        hrefs: ["https://nuture.com.br/products/nuture-daily-boost"],
      },
    ]);
  });

  it("keeps one shopper URL per host when Gemini cites two chunks of the same store", () => {
    expect(
      bindGroundingSupports(
        [
          {
            text: "no site nuture.com.br.",
            uris: [
              "https://vertexaisearch.cloud.google.com/grounding-api-redirect/a",
              "https://vertexaisearch.cloud.google.com/grounding-api-redirect/b",
            ],
          },
        ],
        [
          {
            from: "https://vertexaisearch.cloud.google.com/grounding-api-redirect/a",
            to: "https://nuture.com.br/products/nuture-d3-k2",
            host: "nuture.com.br",
          },
          {
            from: "https://vertexaisearch.cloud.google.com/grounding-api-redirect/b",
            to: "https://nuture.com.br/collections/missing",
            host: "nuture.com.br",
          },
        ],
      ),
    ).toEqual([
      {
        text: "no site nuture.com.br.",
        hosts: ["nuture.com.br"],
        hrefs: ["https://nuture.com.br/products/nuture-d3-k2"],
      },
    ]);
  });

  it("does not invent a homepage when the Gemini chunk never resolved", () => {
    expect(
      bindGroundingSupports(
        [
          {
            text: "Uma frase.",
            uris: ["https://vertexaisearch.cloud.google.com/grounding-api-redirect/x"],
          },
        ],
        [
          {
            from: "https://vertexaisearch.cloud.google.com/grounding-api-redirect/x",
            to: null,
            host: null,
          },
        ],
      ),
    ).toEqual([{ text: "Uma frase.", hosts: [], hrefs: [] }]);
  });
});
