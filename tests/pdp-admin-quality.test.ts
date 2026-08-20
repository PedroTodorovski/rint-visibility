import { describe, expect, it } from "vitest";

import { assessPdpAdminQuality, catalogFoundationGaps, plainTextLength } from "../src/lib/pdp-admin-quality.js";

describe("assessPdpAdminQuality", () => {
  it("flags thin Admin catalogs with sparse attributes and short description", () => {
    const assessment = assessPdpAdminQuality({
      attributes: ["Snowboard"],
      material: null,
      color: null,
      dimension: null,
      image: "https://cdn.shopify.com/x.jpg",
      imageAlt: null,
      descriptionChars: 12,
    });
    expect(assessment.thin).toBe(true);
    expect(assessment.gaps).toEqual(
      expect.arrayContaining(["attributes", "description", "physical", "image_alt"]),
    );
  });

  it("passes a rich Admin catalog even without public schema", () => {
    const assessment = assessPdpAdminQuality({
      attributes: ["Snowboard", "Size: 158", "Flex: Medium"],
      material: "madeira",
      color: "preto",
      dimension: "158 cm",
      image: "https://cdn.shopify.com/x.jpg",
      imageAlt: "Prancha preta 158",
      descriptionChars: 200,
    });
    expect(assessment.thin).toBe(false);
    expect(assessment.gaps).toEqual([]);
    expect(assessment.attributeCount).toBe(3);
  });

  it("strips HTML when measuring description length", () => {
    expect(plainTextLength("<p>Olá <strong>mundo</strong></p>")).toBe("Olá mundo".length);
  });

  it("treats only description and attributes as the catalog foundation", () => {
    expect(catalogFoundationGaps(["image_alt", "physical"])).toEqual([]);
    expect(catalogFoundationGaps(["attributes", "image_alt", "description"])).toEqual([
      "attributes",
      "description",
    ]);
  });
});
