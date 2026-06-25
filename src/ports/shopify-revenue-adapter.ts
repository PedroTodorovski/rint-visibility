import type { AnalysisWindow, PortReadMeta, ShopifyRevenuePort, ShopifySkuRevenue } from "./types.js";

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

function lineItemRevenue(node: {
  discountedTotalSet?: { shopMoney?: { amount?: string } };
  originalTotalSet?: { shopMoney?: { amount?: string } };
} | null | undefined): number {
  const discounted = Number(node?.discountedTotalSet?.shopMoney?.amount ?? NaN);
  if (Number.isFinite(discounted) && discounted > 0) return discounted;
  return Number(node?.originalTotalSet?.shopMoney?.amount ?? 0) || 0;
}

export function createShopifyRevenuePort(
  credentials: ShopifyPortCredentials,
  fetchImpl: typeof fetch = fetch,
): ShopifyRevenuePort {
  const shopDomain = credentials.shopDomain.replace(/^https?:\/\//, "").split("/")[0] ?? credentials.shopDomain;
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
        const response = await fetchImpl(`https://${shopDomain}/admin/api/${apiVersion}/graphql.json`, {
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
        });

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
