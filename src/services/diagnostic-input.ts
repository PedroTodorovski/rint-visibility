import { validationError } from "../lib/errors.js";
import { assessPdpAdminQuality } from "../lib/pdp-admin-quality.js";
import { fetchPublicPdp } from "../lib/pdp-identity.js";
import type { ShopifyProductSnapshotPort } from "../ports/types.js";
import type { ProductRow, PromptRow } from "../repositories/types.js";
import type { DiagnosticRunConfig, ShopifyProductSnapshot } from "./diagnostic-types.js";

const CATEGORY_PATH_RE =
  /\/(collections?|categor(?:y|ia|ias)|departamento|search|pages?|blogs?)(\/|$)/i;

export function isLikelyPdpUrl(url: string): boolean {
  try {
    const parsed = new URL(url);
    const path = parsed.pathname.replace(/\/+$/, "");
    if (!["http:", "https:"].includes(parsed.protocol)) return false;
    if (!path || path === "") return false;
    if (CATEGORY_PATH_RE.test(path)) return false;
    return path.split("/").filter(Boolean).length >= 1;
  } catch {
    return false;
  }
}

export function assertRunLimits(
  products: ProductRow[],
  promptsByProduct: Map<string, PromptRow[]>,
  config: DiagnosticRunConfig,
): void {
  if (config.maxSkus !== null && products.length > config.maxSkus) {
    throw validationError(`Máximo de ${config.maxSkus} SKUs por diagnóstico no plano/fase atual`);
  }

  for (const [productId, prompts] of promptsByProduct) {
    if (config.maxQueriesPerSku !== null && prompts.length > config.maxQueriesPerSku) {
      throw validationError(
        `Produto ${productId} tem ${prompts.length} queries; máximo atual é ${config.maxQueriesPerSku}`,
      );
    }
  }
}

export function groupQueriesByProduct(
  products: ProductRow[],
  prompts: PromptRow[],
): Map<string, PromptRow[]> {
  const active = prompts.filter((prompt) => prompt.active);
  const scoped = active.filter((prompt) => prompt.product_id);
  const legacy = active.filter((prompt) => !prompt.product_id);
  const map = new Map<string, PromptRow[]>();

  if (scoped.length > 0) {
    for (const product of products) {
      const rows = scoped
        .filter((prompt) => prompt.product_id === product.id)
        .sort((a, b) => a.sort_order - b.sort_order || a.created_at.localeCompare(b.created_at));
      if (rows.length > 0) map.set(product.id, rows);
    }
    return map;
  }

  const sortedLegacy = legacy.sort(
    (a, b) => a.sort_order - b.sort_order || a.created_at.localeCompare(b.created_at),
  );
  for (const product of products) {
    map.set(product.id, sortedLegacy);
  }

  return map;
}

export async function validateAndSnapshotSku(
  product: ProductRow,
  shopifyProduct: ShopifyProductSnapshotPort,
  options: { shopifyConnected: boolean } = { shopifyConnected: true },
): Promise<ShopifyProductSnapshot> {
  const errors: string[] = [];

  if (!isLikelyPdpUrl(product.url)) {
    errors.push("URL precisa ser uma PDP; homepage, categoria, coleção ou busca não são aceitas");
  }

  if (options.shopifyConnected) {
    const fetched = await fetchPublicPdp(product.url);
    if (!fetched.alive) {
      errors.push(`URL não respondeu com status ativo (${fetched.status ?? "sem resposta"})`);
    }

    const snapshot = await shopifyProduct.getProductSnapshot({
      ref: product.external_ref,
      url: product.url,
    });

    if (!snapshot) {
      errors.push("Produto não encontrado na Shopify Admin API");
    }

    if (snapshot) {
      if (!snapshot.name.trim()) errors.push("Shopify não retornou nome do produto");
      if (!(snapshot.currentPrice > 0)) errors.push("Shopify não retornou preço atual válido");
    }

    if (errors.length > 0 || !snapshot) {
      throw validationError(`Validação do SKU falhou para ${product.url}: ${errors.join("; ")}`);
    }

    const attributes =
      snapshot.attributes.length > 0 ? snapshot.attributes : fetched.identity.attributes;
    const material = snapshot.material || fetched.identity.material;
    const dimension = snapshot.dimension || fetched.identity.dimension;
    const color = snapshot.color || fetched.identity.color;
    const image = snapshot.image || fetched.identity.image;
    const imageAlt = snapshot.imageAlt ?? null;
    const descriptionChars = snapshot.descriptionChars ?? 0;
    const admin = assessPdpAdminQuality({
      attributes,
      material,
      color,
      dimension,
      image,
      imageAlt,
      descriptionChars,
    });

    return {
      ...snapshot,
      brand: snapshot.brand || fetched.identity.brand,
      currentPrice:
        snapshot.currentPrice > 0 ? snapshot.currentPrice : fetched.identity.currentPrice,
      currency: snapshot.currency || fetched.identity.currency,
      attributes,
      material,
      dimension,
      color,
      image,
      imageAlt,
      descriptionChars,
      meta: {
        ...snapshot.meta,
        source: snapshot.meta.source || "shopify_api",
        hasJsonLd: fetched.blocked ? null : fetched.identity.hasJsonLd,
        hasOg: fetched.blocked ? false : fetched.identity.hasOg,
        imageSource: snapshot.image ? "shopify_api" : fetched.identity.imageSource,
        admin,
      },
    };
  }

  const fetched = await fetchPublicPdp(product.url);
  if (!fetched.alive) {
    errors.push(`URL não respondeu com status ativo (${fetched.status ?? "sem resposta"})`);
  } else if (fetched.blocked) {
    errors.push("Página pública inacessível (loja com senha ou bloqueio de bot)");
  }

  const name = fetched.identity.name?.trim() || product.title?.trim() || "";
  if (!name) {
    errors.push("Nome do produto não encontrado na PDP; informe o nome para continuar");
  }

  if (errors.length > 0) {
    throw validationError(`Validação do SKU falhou para ${product.url}: ${errors.join("; ")}`);
  }

  return {
    externalRef: product.external_ref,
    url: product.url,
    name,
    brand: fetched.identity.brand,
    currentPrice: fetched.identity.currentPrice,
    currency: fetched.identity.currency,
    attributes: fetched.identity.attributes,
    variants: [],
    inventoryAvailable: null,
    material: fetched.identity.material,
    dimension: fetched.identity.dimension,
    color: fetched.identity.color,
    image: fetched.identity.image,
    meta: {
      source: "public_pdp",
      fetchedAt: new Date().toISOString(),
      hasJsonLd: fetched.identity.hasJsonLd,
      hasOg: fetched.identity.hasOg,
      imageSource: fetched.identity.imageSource,
    },
  };
}
