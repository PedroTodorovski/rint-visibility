import { compactIdentity, foldIdentity } from "./cited-offer.js";

/** Twin of rint-app/src/lib/diagnosis-query-kind.ts */

const MIN_NEEDLE = 4;
const MIN_COMPACT_NEEDLE = 8;

export type ShopperQuestionKind = "category" | "named";

export type ShopperIdentity = {
  brand: string | null | undefined;
  productName: string | null | undefined;
};

export type QueryCitationRow = {
  text: string;
  cited: boolean;
};

export type QueryCitationSplit = {
  categoryCited: number;
  categoryTotal: number;
  namedCited: number;
  namedTotal: number;
};

function remainderAfterBrand(brand: string, product: string): string {
  if (!brand || !product.startsWith(`${brand} `)) return "";
  return product.slice(brand.length).trim();
}

function needlesFromIdentity(identity: ShopperIdentity): string[] {
  const needles = new Set<string>();
  const brand = foldIdentity(identity.brand);
  const product = foldIdentity(identity.productName);
  if (brand.length >= MIN_NEEDLE) needles.add(brand);
  const brandHead = brand.split(" ")[0] ?? "";
  if (brandHead.length >= MIN_NEEDLE) needles.add(brandHead);
  if (product.length >= MIN_NEEDLE) needles.add(product);
  const rest = remainderAfterBrand(brand, product);
  if (rest.includes(" ") && rest.length >= MIN_NEEDLE) needles.add(rest);
  return [...needles];
}

function compactNeedlesFromIdentity(identity: ShopperIdentity): string[] {
  const needles = new Set<string>();
  const brandCompact = compactIdentity(identity.brand);
  if (brandCompact.length >= MIN_COMPACT_NEEDLE) needles.add(brandCompact);
  const rest = remainderAfterBrand(
    foldIdentity(identity.brand),
    foldIdentity(identity.productName),
  );
  if (rest.includes(" ")) {
    const restCompact = compactIdentity(rest);
    if (restCompact.length >= MIN_COMPACT_NEEDLE) needles.add(restCompact);
  }
  return [...needles];
}

export function isNamedShopperQuestion(queryText: string, identity: ShopperIdentity): boolean {
  const haystack = foldIdentity(queryText);
  if (!haystack) return false;
  const padded = ` ${haystack} `;
  if (needlesFromIdentity(identity).some((needle) => padded.includes(` ${needle} `))) {
    return true;
  }
  const compactHay = compactIdentity(queryText);
  return compactNeedlesFromIdentity(identity).some((needle) => compactHay.includes(needle));
}

export function shopperQuestionKind(
  queryText: string,
  identity: ShopperIdentity,
): ShopperQuestionKind {
  return isNamedShopperQuestion(queryText, identity) ? "named" : "category";
}

export function splitQueryCitations(
  rows: QueryCitationRow[],
  identity: ShopperIdentity,
): QueryCitationSplit {
  const split: QueryCitationSplit = {
    categoryCited: 0,
    categoryTotal: 0,
    namedCited: 0,
    namedTotal: 0,
  };
  for (const row of rows) {
    if (shopperQuestionKind(row.text, identity) === "named") {
      split.namedTotal += 1;
      if (row.cited) split.namedCited += 1;
    } else {
      split.categoryTotal += 1;
      if (row.cited) split.categoryCited += 1;
    }
  }
  return split;
}

export function namedOnlyCitation(split: QueryCitationSplit): boolean {
  return (
    split.categoryTotal > 0 &&
    split.categoryCited === 0 &&
    split.namedTotal > 0 &&
    split.namedCited > 0
  );
}
