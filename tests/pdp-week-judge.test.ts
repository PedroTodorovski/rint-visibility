import { describe, expect, it } from "vitest";

import { formulateTrackPdpFirstAction } from "../src/services/pdp-out-first-action.js";
import { judgePageWeek } from "../src/services/pdp-week-judge.js";

const nuture = {
  skuName: "Nuture Daily Boost",
  brand: "Nuture",
  productUrl: "https://nuture.com.br/products/nuture-daily-boost",
  access: "open" as const,
  hasJsonLd: false as boolean | null,
  shopifyConnected: true,
  panelMismatch: false,
};

describe("judgePageWeek + formulateTrackPdpFirstAction", () => {
  it("emits gold password copy", () => {
    const judgment = judgePageWeek({
      access: "password",
      hasJsonLd: null,
      shopifyConnected: true,
      panelMismatch: false,
      marketplaceUrl: false,
    });
    const brief = formulateTrackPdpFirstAction({
      ...nuture,
      move: judgment.move,
      access: "password",
      hasJsonLd: null,
    });
    expect(brief?.first_action).toBe(
      "Esta URL está com senha. Sem a porta aberta, a IA não lê o Nuture Daily Boost. Esta semana: tire a senha da página do produto.",
    );
    expect(brief?.surface).toBe("url_medida");
    expect(brief?.source).toBe("nao_lemos");
  });

  it("does not invent schema on a closed door", () => {
    const brief = formulateTrackPdpFirstAction({
      ...nuture,
      move: "abrir_senha",
      access: "password",
      hasJsonLd: false,
    });
    expect(brief?.has_json_ld).toBeNull();
    expect(brief?.source).toBe("nao_lemos");
  });

  it("matches gold missing-schema copy", () => {
    const brief = formulateTrackPdpFirstAction({ ...nuture, move: "expor_schema" });
    expect(brief?.first_action).toBe(
      "O cadastro no Shopify já tem o produto. A página pública não expõe a ficha estruturada. Esta semana: exponha essa ficha em nuture.com.br/products/nuture-daily-boost.",
    );
  });

  it("does not claim Shopify cadastro when the product is only on the street", () => {
    const brief = formulateTrackPdpFirstAction({
      ...nuture,
      move: "expor_schema",
      shopifyConnected: false,
    });
    expect(brief?.first_action).toBe(
      "A página pública não expõe a ficha estruturada. Esta semana: exponha essa ficha em nuture.com.br/products/nuture-daily-boost.",
    );
  });

  it("sends mismatch to Integrações", () => {
    const brief = formulateTrackPdpFirstAction({
      ...nuture,
      move: "ligar_loja_da_url",
      panelMismatch: true,
      hasJsonLd: true,
    });
    expect(brief?.target_url).toBe("/integrations");
    expect(brief?.surface).toBe("integracoes");
    expect(brief?.first_action).toContain("Integrações");
    expect(brief?.first_action).toContain("não está no Shopify");
  });

  it("returns null when the judge abstains", () => {
    expect(
      formulateTrackPdpFirstAction({ ...nuture, move: undefined, hasJsonLd: true }),
    ).toBeNull();
  });

  it("does not treat marketplace as shop≠URL", () => {
    expect(
      judgePageWeek({
        access: "open",
        hasJsonLd: true,
        shopifyConnected: true,
        panelMismatch: true,
        marketplaceUrl: true,
      }).abstainReason,
    ).toBe("ok");
  });

  it("still opens a password door when Shopify is off", () => {
    expect(
      judgePageWeek({
        access: "password",
        hasJsonLd: null,
        shopifyConnected: false,
        panelMismatch: false,
        marketplaceUrl: false,
      }).move,
    ).toBe("abrir_senha");
  });

  it("does not treat missing street schema as the week when Shopify is off", () => {
    expect(
      judgePageWeek({
        access: "open",
        hasJsonLd: false,
        shopifyConnected: false,
        panelMismatch: false,
        marketplaceUrl: false,
      }).abstainReason,
    ).toBe("buraco");
  });
});
