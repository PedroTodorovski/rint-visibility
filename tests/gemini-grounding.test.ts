import { describe, expect, it } from "vitest";

import {
  bindGroundingSupports,
  extractGroundingMetadata,
  objectGroundingVerdicts,
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

describe("objectGroundingVerdicts", () => {
  const supports = [
    { text: "O Daily Boost aparece no site da Nuture.", hosts: ["nuture.com.br"], hrefs: [] },
    { text: "AG1 continua o mais citado no Brasil.", hosts: ["drinkag1.com"], hrefs: [] },
  ];
  const nuture = { names: ["Nuture", "Daily Boost"] };
  const ag1 = { names: ["AG1"] };

  it("ADR-003 residual gap: confirms the grounded object and demotes the other co-mentioned one", () => {
    // Both objects are named in the same already-cited query. Nuture's own sentence resolves to
    // the client host; AG1's own sentence resolves elsewhere — once Nuture is positively
    // confirmed, AG1 is demoted to `false` instead of inheriting the query-level "cited" via
    // fuzzy name matching.
    expect(objectGroundingVerdicts([nuture, ag1], supports, ["nuture.com.br"])).toEqual([
      true,
      false,
    ]);
  });

  it("real bug this closes: a client name that is a text-prefix of a longer competitor name does not falsely deny the client", () => {
    // "Acme" (client) is a literal substring of "Acme Studio" (competitor) — the exact shape of
    // the motivating ADR-003 example. A sentence that names only "Acme Studio" must not be read
    // as also naming "Acme": that would make the naive substring check wrongly attribute the
    // competitor's host mismatch to the client's own object as a confident `false`.
    const acme = { names: ["Acme", "Hero Sofa"] };
    const acmeStudio = { names: ["Acme Studio", "Sofá Modular"] };
    const ambiguousOnly = [
      {
        text: "A Acme Studio também tem um Sofá Modular parecido.",
        hosts: ["acmestudio.example"],
        hrefs: [],
      },
    ];
    // No sentence unambiguously names "Acme" alone — the only sentence mentioning it is really
    // about "Acme Studio". Both must come back with no signal, not a confident `false` for Acme.
    expect(objectGroundingVerdicts([acme, acmeStudio], ambiguousOnly, ["acme.example"])).toEqual([
      undefined,
      undefined,
    ]);

    const withDedicatedSentence = [
      { text: "A Acme vende o Hero Sofa direto no site.", hosts: ["acme.example"], hrefs: [] },
      ...ambiguousOnly,
    ];
    // With a dedicated, unambiguous sentence for the client, it gets confirmed `true` and the
    // distinctly-keyed "Acme Studio" is correctly demoted to `false` — the ambiguous sentence
    // still contributes no signal to either.
    expect(
      objectGroundingVerdicts([acme, acmeStudio], withDedicatedSentence, ["acme.example"]),
    ).toEqual([true, false]);
  });

  it("does not penalize the client's own product cited only through a marketplace/reseller host", () => {
    // The client's real product is named in a sentence that resolves to a reseller's host, not
    // the client's own domain — a normal, common pattern (the codebase's own seller/marketplace
    // handling elsewhere assumes this). With no OTHER object positively confirmed as the client
    // in this result, this must stay `undefined` (defer to the existing per-query fallback), not
    // a confident `false` that would wrongly exclude the client's own object from its own report.
    const clientViaMarketplace = [
      {
        text: "A Nuture Daily Boost está disponível no Mercado Livre.",
        hosts: ["mercadolivre.com.br"],
        hrefs: [],
      },
    ];
    expect(objectGroundingVerdicts([nuture], clientViaMarketplace, ["nuture.com.br"])).toEqual([
      undefined,
    ]);
  });

  it("a sentence naming two different objects at once contributes no signal to either", () => {
    const compound = [
      {
        text: "Diferente da Nuture, a AG1 custa mais.",
        hosts: ["nuture.com.br"],
        hrefs: [],
      },
    ];
    expect(objectGroundingVerdicts([nuture, ag1], compound, ["nuture.com.br"])).toEqual([
      undefined,
      undefined,
    ]);
  });

  it("returns all undefined when no support sentence names any object at all", () => {
    const other = { names: ["Vitamina D3K2"] };
    expect(objectGroundingVerdicts([other], supports, ["nuture.com.br"])).toEqual([undefined]);
  });

  it("ignores names too short to match safely", () => {
    const short = { names: ["Ag"] };
    expect(objectGroundingVerdicts([short], supports, ["nuture.com.br"])).toEqual([undefined]);
  });

  it("returns undefined for every object with no client hosts to compare against", () => {
    expect(objectGroundingVerdicts([nuture, ag1], supports, [])).toEqual([undefined, undefined]);
  });

  it("matches case- and accent-insensitively", () => {
    const accented = [{ text: "A NÚTURE tem o Daily Boost.", hosts: ["nuture.com.br"], hrefs: [] }];
    expect(objectGroundingVerdicts([{ names: ["nûture"] }], accented, ["nuture.com.br"])).toEqual([
      true,
    ]);
  });

  it("returns an empty array for an empty object list", () => {
    expect(objectGroundingVerdicts([], supports, ["nuture.com.br"])).toEqual([]);
  });
});
