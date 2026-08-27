import { describe, expect, it } from "vitest";

import { founderFacingAttributes } from "../src/lib/founder-attributes.js";

describe("founderFacingAttributes", () => {
  it("keeps short catalog facts and option pairs", () => {
    expect(
      founderFacingAttributes([
        "Snowboard",
        "Size: 158",
        "Quantidade: 1 unidade",
        "Multi Unitário",
      ]),
    ).toEqual(["Snowboard", "Size: 158", "Quantidade: 1 unidade", "Multi Unitário"]);
  });

  it("drops Shopify GIDs, rich-text JSON, and html metafields", () => {
    expect(
      founderFacingAttributes([
        'benefits_list_images: ["gid://shopify/Metaobject/123"]',
        'specification_html_title: {"type":"root","children":[{"type":"paragraph","children":[{"type":"text","value":"Ficha"}]}]}',
        'data_html_content: {"type":"root","children":[]}',
        "vitaminas ativas",
      ]),
    ).toEqual(["vitaminas ativas"]);
  });

  it("splits JSON string lists and comma+space Gemini blobs into chips", () => {
    expect(
      founderFacingAttributes([
        'composition_text_list: ["Vitamina D3", "Metilfolato"]',
        "Centrum Silver +50, Centrum Junior, Flintstones completo",
      ]),
    ).toEqual([
      "Vitamina D3",
      "Metilfolato",
      "Centrum Silver +50",
      "Centrum Junior",
      "Flintstones completo",
    ]);
  });

  it("does not split Brazilian decimal commas", () => {
    expect(founderFacingAttributes(["Preço: R$ 71,90"])).toEqual(["Preço: R$ 71,90"]);
  });

  it("drops identity names that belong on the object, not as attributes", () => {
    expect(
      founderFacingAttributes(["Centrum Silver +50", "NSF", "75 vitamins"], {
        dropNames: ["Centrum", "Centrum Silver +50"],
      }),
    ).toEqual(["NSF", "75 vitamins"]);
  });

  it("drops full sentences that are not product characteristics", () => {
    expect(
      founderFacingAttributes([
        "ampla disponibilidade",
        "pode ser necessário complementar a suplementação de ferro",
      ]),
    ).toEqual(["ampla disponibilidade"]);
  });
});
