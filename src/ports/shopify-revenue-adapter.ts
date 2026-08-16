import type { ShopifyProductSnapshot } from "../services/diagnostic-types.js";
import type {
  AnalysisWindow,
  PortReadMeta,
  ShopifyProductSnapshotPort,
  ShopifyRevenuePort,
  ShopifySkuRevenue,
} from "./types.js";

export type ShopifyPortCredentials = {
  shopDomain: string;
  accessToken: string;
  adminApiVersion?: string;
};

type ShopifyOrdersResponse = {
  data?: {
    orders?: {
      edges?: Array<{
        node?: {
          id?: string;
          lineItems?: {
            edges?: Array<{
              node?: {
                quantity?: number;
                product?: { id?: string | null } | null;
                originalTotalSet?: { shopMoney?: { amount?: string } };
                discountedTotalSet?: { shopMoney?: { amount?: string } };
              };
            }>;
          };
        };
      }>;
      pageInfo?: { hasNextPage?: boolean; endCursor?: string | null };
    };
  };
  errors?: Array<{ message?: string }>;
};

type ShopifyProductResponse = {
  data?: {
    product?: ShopifyProductNode | null;
    productByHandle?: ShopifyProductNode | null;
  };
  errors?: Array<{ message?: string }>;
};

type ShopifyProductNode = {
  id?: string;
  title?: string;
  handle?: string;
  vendor?: string | null;
  onlineStoreUrl?: string | null;
  featuredImage?: { altText?: string | null } | null;
  priceRangeV2?: {
    minVariantPrice?: { amount?: string; currencyCode?: string };
  };
  totalInventory?: number | null;
  options?: Array<{ name?: string; values?: string[] }>;
  metafields?: {
    edges?: Array<{
      node?: { namespace?: string; key?: string; value?: string | null };
    }>;
  };
  variants?: {
    edges?: Array<{
      node?: {
        id?: string;
        title?: string;
        inventoryQuantity?: number | null;
        price?: string;
        selectedOptions?: Array<{ name?: string; value?: string }>;
      };
    }>;
  };
};

function metaFor(shopDomain: string): PortReadMeta {
  return {
    port: "shopify",
    fetchedAt: new Date().toISOString(),
    source: shopDomain,
  };
}

export function normalizeShopifyProductRef(ref: string): string | null {
  const trimmed = ref.trim();
  if (!trimmed) return null;
  if (trimmed.startsWith("gid://shopify/Product/")) return trimmed;
  if (/^\d+$/.test(trimmed)) return `gid://shopify/Product/${trimmed}`;
  return null;
}

export function extractShopifyProductHandle(url: string): string | null {
  try {
    const parsed = new URL(url);
    const parts = parsed.pathname.split("/").filter(Boolean);
    const productsIndex = parts.findIndex((part) => part === "products");
    if (productsIndex === -1) return null;
    return parts[productsIndex + 1] ?? null;
  } catch {
    return null;
  }
}

function lineItemRevenue(
  node:
    | {
        discountedTotalSet?: { shopMoney?: { amount?: string } };
        originalTotalSet?: { shopMoney?: { amount?: string } };
      }
    | null
    | undefined,
): number {
  const discounted = Number(node?.discountedTotalSet?.shopMoney?.amount ?? NaN);
  if (Number.isFinite(discounted) && discounted > 0) return discounted;
  return Number(node?.originalTotalSet?.shopMoney?.amount ?? 0) || 0;
}

export function createShopifyRevenuePort(
  credentials: ShopifyPortCredentials,
  fetchImpl: typeof fetch = fetch,
): ShopifyRevenuePort {
  const shopDomain =
    credentials.shopDomain.replace(/^https?:\/\//, "").split("/")[0] ?? credentials.shopDomain;
  const apiVersion = credentials.adminApiVersion?.trim() || "2026-04";

  return {
    async getSkuRevenue(ref: string, window: AnalysisWindow): Promise<ShopifySkuRevenue> {
      const productGid = normalizeShopifyProductRef(ref);
      if (!productGid) {
        return {
          externalRef: ref,
          revenue: 0,
          orders: 0,
          ticketMedio: 0,
          meta: metaFor(shopDomain),
        };
      }

      const queryFilter = `created_at:>=${window.start} created_at:<=${window.end} financial_status:paid`;
      let after: string | null = null;
      let revenue = 0;
      let lineQty = 0;
      const orderIds = new Set<string>();

      for (let page = 0; page < 20; page++) {
        const response = await fetchImpl(
          `https://${shopDomain}/admin/api/${apiVersion}/graphql.json`,
          {
            method: "POST",
            headers: {
              Accept: "application/json",
              "Content-Type": "application/json",
              "X-Shopify-Access-Token": credentials.accessToken,
            },
            body: JSON.stringify({
              query: `#graphql
              query RintSkuOrders($query: String!, $first: Int!, $after: String) {
                orders(first: $first, after: $after, query: $query, sortKey: CREATED_AT) {
                  edges {
                    node {
                      id
                      lineItems(first: 50) {
                        edges {
                          node {
                            quantity
                            product { id }
                            originalTotalSet { shopMoney { amount } }
                            discountedTotalSet { shopMoney { amount } }
                          }
                        }
                      }
                    }
                  }
                  pageInfo { hasNextPage endCursor }
                }
              }
            `,
              variables: { query: queryFilter, first: 50, after },
            }),
          },
        );

        const payload = (await response.json()) as ShopifyOrdersResponse;
        if (!response.ok || payload.errors?.length) {
          throw new Error(payload.errors?.[0]?.message ?? "shopify_orders_query_failed");
        }

        const orders = payload.data?.orders;
        const edges = orders?.edges ?? [];
        for (const edge of edges) {
          const orderId = edge.node?.id;
          const lineEdges = edge.node?.lineItems?.edges ?? [];
          for (const lineEdge of lineEdges) {
            const line = lineEdge.node;
            if (!line || line.product?.id !== productGid) continue;
            if (orderId) orderIds.add(orderId);
            const qty = Number(line.quantity ?? 0) || 0;
            lineQty += qty;
            revenue += lineItemRevenue(line);
          }
        }

        if (!orders?.pageInfo?.hasNextPage || !orders.pageInfo.endCursor) break;
        after = orders.pageInfo.endCursor;
      }

      const orders = orderIds.size;
      const ticketMedio = orders > 0 ? revenue / orders : 0;

      return {
        externalRef: productGid,
        revenue,
        orders,
        ticketMedio,
        meta: metaFor(shopDomain),
      };
    },
  };
}

const PRODUCT_SNAPSHOT_FIELDS = `
                id
                title
                handle
                vendor
                onlineStoreUrl
                totalInventory
                featuredImage { altText }
                priceRangeV2 { minVariantPrice { amount currencyCode } }
                options { name values }
                metafields(first: 20, namespace: "custom") {
                  edges { node { namespace key value } }
                }
                variants(first: 20) {
                  edges {
                    node {
                      id
                      title
                      inventoryQuantity
                      price
                      selectedOptions { name value }
                    }
                  }
                }
`;

function productSnapshotGraphql(by: "id" | "handle"): string {
  if (by === "id") {
    return `#graphql
            query RintProductSnapshotById($id: ID!) {
              product(id: $id) {${PRODUCT_SNAPSHOT_FIELDS}              }
            }
          `;
  }
  return `#graphql
            query RintProductSnapshotByHandle($handle: String!) {
              productByHandle(handle: $handle) {${PRODUCT_SNAPSHOT_FIELDS}              }
            }
          `;
}

function productAttributes(product: ShopifyProductNode): {
  attributes: string[];
  material: string | null;
  dimension: string | null;
  color: string | null;
} {
  const values = new Map<string, string>();

  for (const option of product.options ?? []) {
    const name = option.name?.trim();
    const first = option.values?.find((value) => value.trim().length > 0)?.trim();
    if (name && first) values.set(name.toLowerCase(), `${name}: ${first}`);
  }

  for (const edge of product.metafields?.edges ?? []) {
    const key = edge.node?.key?.trim();
    const value = edge.node?.value?.trim();
    if (!key || !value) continue;
    values.set(key.toLowerCase(), `${key}: ${value}`);
  }

  const selectedFromVariants = product.variants?.edges?.[0]?.node?.selectedOptions ?? [];
  for (const selected of selectedFromVariants) {
    const name = selected.name?.trim();
    const value = selected.value?.trim();
    if (name && value) values.set(name.toLowerCase(), `${name}: ${value}`);
  }

  const findValue = (needles: string[]): string | null => {
    for (const [key, value] of values) {
      if (needles.some((needle) => key.includes(needle))) return value;
    }
    return null;
  };

  const material = findValue(["material", "tecido", "fabric"]);
  const dimension = findValue(["dimens", "medida", "size", "tamanho", "peso"]);
  const color = findValue(["cor", "color"]);

  return {
    attributes: [
      ...new Set([...values.values(), material, dimension, color].filter(Boolean) as string[]),
    ],
    material,
    dimension,
    color,
  };
}

export function createShopifyProductSnapshotPort(
  credentials: ShopifyPortCredentials,
  fetchImpl: typeof fetch = fetch,
): ShopifyProductSnapshotPort {
  const shopDomain =
    credentials.shopDomain.replace(/^https?:\/\//, "").split("/")[0] ?? credentials.shopDomain;
  const apiVersion = credentials.adminApiVersion?.trim() || "2026-04";

  return {
    async getProductSnapshot(input): Promise<ShopifyProductSnapshot | null> {
      const productGid = input.ref ? normalizeShopifyProductRef(input.ref) : null;
      const handle = extractShopifyProductHandle(input.url);

      let query: string;
      let variables: { id: string } | { handle: string };

      if (productGid) {
        query = productSnapshotGraphql("id");
        variables = { id: productGid };
      } else if (handle) {
        query = productSnapshotGraphql("handle");
        variables = { handle };
      } else {
        return null;
      }

      const response = await fetchImpl(
        `https://${shopDomain}/admin/api/${apiVersion}/graphql.json`,
        {
          method: "POST",
          headers: {
            Accept: "application/json",
            "Content-Type": "application/json",
            "X-Shopify-Access-Token": credentials.accessToken,
          },
          body: JSON.stringify({ query, variables }),
        },
      );

      const payload = (await response.json()) as ShopifyProductResponse;
      if (!response.ok || payload.errors?.length) {
        throw new Error(payload.errors?.[0]?.message ?? "shopify_product_query_failed");
      }

      const product = payload.data?.product ?? payload.data?.productByHandle ?? null;
      if (!product?.id || !product.title) return null;

      const attributes = productAttributes(product);
      const variants = (product.variants?.edges ?? []).map((edge) => {
        const node = edge.node;
        return {
          id: node?.id ?? null,
          title: node?.title ?? null,
          price: Number(node?.price ?? NaN) || null,
          inventoryQuantity:
            typeof node?.inventoryQuantity === "number" ? node.inventoryQuantity : null,
          selectedOptions: Object.fromEntries(
            (node?.selectedOptions ?? [])
              .filter((option) => option.name && option.value)
              .map((option) => [option.name!, option.value!]),
          ),
        };
      });

      return {
        externalRef: product.id,
        url: product.onlineStoreUrl ?? input.url,
        name: product.title,
        brand: product.vendor ?? null,
        currentPrice: Number(product.priceRangeV2?.minVariantPrice?.amount ?? 0) || 0,
        currency: product.priceRangeV2?.minVariantPrice?.currencyCode ?? null,
        attributes: attributes.attributes,
        variants,
        inventoryAvailable:
          typeof product.totalInventory === "number" ? product.totalInventory : null,
        material: attributes.material,
        dimension: attributes.dimension,
        color: attributes.color,
        meta: metaFor(shopDomain),
      };
    },
  };
}
