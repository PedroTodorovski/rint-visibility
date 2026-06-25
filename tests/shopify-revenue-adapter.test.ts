import { describe, expect, it } from "vitest";

import {
  createShopifyRevenuePort,
  normalizeShopifyProductRef,
} from "../src/ports/shopify-revenue-adapter.js";

describe("shopify-revenue-adapter", () => {
  it("normalizes numeric and gid product refs", () => {
    expect(normalizeShopifyProductRef("12345")).toBe("gid://shopify/Product/12345");
    expect(normalizeShopifyProductRef("gid://shopify/Product/99")).toBe("gid://shopify/Product/99");
    expect(normalizeShopifyProductRef("")).toBeNull();
  });

  it("aggregates revenue for matching line items", async () => {
    const productGid = "gid://shopify/Product/777";
    const fetchImpl = async () =>
      new Response(
        JSON.stringify({
          data: {
            orders: {
              edges: [
                {
                  node: {
                    id: "gid://shopify/Order/1",
                    lineItems: {
                      edges: [
                        {
                          node: {
                            quantity: 2,
                            product: { id: productGid },
                            discountedTotalSet: { shopMoney: { amount: "900.00" } },
                          },
                        },
                        {
                          node: {
                            quantity: 1,
                            product: { id: "gid://shopify/Product/other" },
                            discountedTotalSet: { shopMoney: { amount: "100.00" } },
                          },
                        },
                      ],
                    },
                  },
                },
                {
                  node: {
                    id: "gid://shopify/Order/2",
                    lineItems: {
                      edges: [
                        {
                          node: {
                            quantity: 1,
                            product: { id: productGid },
                            originalTotalSet: { shopMoney: { amount: "450.00" } },
                          },
                        },
                      ],
                    },
                  },
                },
              ],
              pageInfo: { hasNextPage: false, endCursor: null },
            },
          },
        }),
        { status: 200, headers: { "Content-Type": "application/json" } },
      );

    const port = createShopifyRevenuePort(
      {
        shopDomain: "inflow.myshopify.com",
        accessToken: "shpat_test",
        adminApiVersion: "2026-04",
      },
      fetchImpl as typeof fetch,
    );

    const result = await port.getSkuRevenue("777", { start: "2026-01-01", end: "2026-01-31" });

    expect(result.externalRef).toBe(productGid);
    expect(result.revenue).toBe(1350);
    expect(result.orders).toBe(2);
    expect(result.ticketMedio).toBe(675);
    expect(result.meta.source).toBe("inflow.myshopify.com");
  });
});
