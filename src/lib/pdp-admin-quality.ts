/**
 * PDP readiness from Shopify Admin snapshot (pontual read).
 * Public JSON-LD is a crawl floor — Admin is the gold catalog when connected.
 */

export type PdpAdminGap = "attributes" | "description" | "physical" | "image_alt";

export type PdpAdminAssessment = {
  attributeCount: number;
  descriptionChars: number;
  hasMaterial: boolean;
  hasColor: boolean;
  hasDimension: boolean;
  hasImageAlt: boolean;
  /** Thin catalog for AI recognition — founder-actionable Admin gaps. */
  thin: boolean;
  gaps: PdpAdminGap[];
};

const MIN_USEFUL_ATTRIBUTES = 3;
const MIN_DESCRIPTION_CHARS = 80;

export function plainTextLength(html: string | null | undefined): number {
  if (!html?.trim()) return 0;
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/gi, " ")
    .replace(/\s+/g, " ")
    .trim().length;
}

export function assessPdpAdminQuality(input: {
  attributes: string[];
  material?: string | null;
  color?: string | null;
  dimension?: string | null;
  image?: string | null;
  imageAlt?: string | null;
  descriptionHtml?: string | null;
  descriptionChars?: number;
}): PdpAdminAssessment {
  const attributeCount = input.attributes.filter((value) => value.trim().length > 0).length;
  const descriptionChars =
    typeof input.descriptionChars === "number"
      ? input.descriptionChars
      : plainTextLength(input.descriptionHtml);
  const hasMaterial = Boolean(input.material?.trim());
  const hasColor = Boolean(input.color?.trim());
  const hasDimension = Boolean(input.dimension?.trim());
  const hasImage = Boolean(input.image?.trim());
  const hasImageAlt = Boolean(input.imageAlt?.trim());

  const gaps: PdpAdminGap[] = [];
  if (attributeCount < MIN_USEFUL_ATTRIBUTES) gaps.push("attributes");
  if (descriptionChars < MIN_DESCRIPTION_CHARS) gaps.push("description");
  if (!hasMaterial && !hasColor && !hasDimension) gaps.push("physical");
  if (hasImage && !hasImageAlt) gaps.push("image_alt");

  const thin =
    gaps.includes("attributes") ||
    gaps.includes("description") ||
    gaps.includes("physical") ||
    gaps.length >= 2;

  return {
    attributeCount,
    descriptionChars,
    hasMaterial,
    hasColor,
    hasDimension,
    hasImageAlt,
    thin,
    gaps,
  };
}
