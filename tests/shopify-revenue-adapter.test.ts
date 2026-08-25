import { describe, expect, it } from "vitest";

import {
  createShopifyProductSnapshotPort,
  createShopifyRevenuePort,
  extractShopifyProductHandle,
  normalizeShopifyProductRef,
  SHOPIFY_ADMIN_USER_AGENT,
  shopifyGraphqlErrorMessage,
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

  it("degrades to a zero-revenue read instead of throwing when Order access is not approved", async () => {
    const productGid = "gid://shopify/Product/777";
    const fetchImpl = async () =>
      new Response(
        JSON.stringify({
          errors:
            "This app is not approved to access the Order object. See https://shopify.dev/docs/apps/launch/protected-customer-data for more details.",
        }),
        { status: 403, headers: { "Content-Type": "application/json" } },
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
    expect(result.revenue).toBe(0);
    expect(result.orders).toBe(0);
    expect(result.ticketMedio).toBe(0);
    expect(result.meta.source).toBe("inflow.myshopify.com");
  });

  it("extracts a product handle from a PDP URL", () => {
    expect(
      extractShopifyProductHandle(
        "https://rint-test-store.myshopify.com/products/the-multi-location-snowboard",
      ),
    ).toBe("the-multi-location-snowboard");
  });

  it("queries product by handle with String! when there is no GID", async () => {
    let body: { query?: string; variables?: Record<string, unknown> } = {};
    const fetchImpl = async (_url: string, init?: RequestInit) => {
      body = JSON.parse(String(init?.body)) as typeof body;
      return new Response(
        JSON.stringify({
          data: {
            productByHandle: {
              id: "gid://shopify/Product/1",
              title: "Snowboard",
              vendor: "Rint",
              productType: "Snowboard",
              onlineStoreUrl:
                "https://rint-test-store.myshopify.com/products/the-multi-location-snowboard",
              featuredImage: { url: "https://cdn.shopify.com/s/files/1/snowboard.jpg" },
              options: [{ name: "Size", values: ["158"] }],
              priceRangeV2: { minVariantPrice: { amount: "629.95", currencyCode: "BRL" } },
              variants: { edges: [] },
            },
          },
        }),
        { status: 200, headers: { "Content-Type": "application/json" } },
      );
    };

    const port = createShopifyProductSnapshotPort(
      { shopDomain: "rint-test-store.myshopify.com", accessToken: "shpat_test" },
      fetchImpl as typeof fetch,
    );

    const snapshot = await port.getProductSnapshot({
      ref: null,
      url: "https://rint-test-store.myshopify.com/products/the-multi-location-snowboard",
    });

    expect(body.query).toContain("$handle: String!");
    expect(body.query).toContain("productType");
    expect(body.query).toContain("descriptionHtml");
    expect(body.query).not.toContain("$id:");
    expect(body.variables).toEqual({ handle: "the-multi-location-snowboard" });
    expect(snapshot?.name).toBe("Snowboard");
    expect(snapshot?.currentPrice).toBe(629.95);
    expect(snapshot?.image).toBe("https://cdn.shopify.com/s/files/1/snowboard.jpg");
    expect(snapshot?.attributes[0]).toBe("Snowboard");
    expect(snapshot?.attributes).toContain("Size: 158");
    expect(snapshot?.attributes).not.toContain("Title: Default Title");
    expect(snapshot?.meta.admin?.thin).toBe(true);
    expect(snapshot?.meta.admin?.gaps).toEqual(
      expect.arrayContaining(["attributes", "description", "image_alt"]),
    );
  });

  it("queries product by ID! when a GID exists, never sending a null $id", async () => {
    let body: { query?: string; variables?: Record<string, unknown> } = {};
    const fetchImpl = async (_url: string, init?: RequestInit) => {
      body = JSON.parse(String(init?.body)) as typeof body;
      return new Response(
        JSON.stringify({
          data: {
            product: {
              id: "gid://shopify/Product/99",
              title: "Hero",
              options: [{ name: "Color", values: ["Black"] }],
              priceRangeV2: { minVariantPrice: { amount: "10.00", currencyCode: "BRL" } },
              variants: { edges: [] },
            },
          },
        }),
        { status: 200, headers: { "Content-Type": "application/json" } },
      );
    };

    const port = createShopifyProductSnapshotPort(
      { shopDomain: "inflow.myshopify.com", accessToken: "shpat_test" },
      fetchImpl as typeof fetch,
    );

    const snapshot = await port.getProductSnapshot({
      ref: "99",
      url: "https://inflow.myshopify.com/products/hero",
    });

    expect(body.query).toContain("$id: ID!");
    expect(body.query).not.toContain("$handle:");
    expect(body.variables).toEqual({ id: "gid://shopify/Product/99" });
    expect(snapshot?.externalRef).toBe("gid://shopify/Product/99");
  });

  it("drops Shopify's dummy Title: Default Title and keeps productType", async () => {
    const fetchImpl = async () =>
      new Response(
        JSON.stringify({
          data: {
            product: {
              id: "gid://shopify/Product/2",
              title: "The Multi-location Snowboard",
              vendor: "rint-test-store",
              productType: "snowboard",
              options: [{ name: "Title", values: ["Default Title"] }],
              priceRangeV2: { minVariantPrice: { amount: "729.95", currencyCode: "BRL" } },
              variants: {
                edges: [
                  {
                    node: {
                      id: "gid://shopify/ProductVariant/1",
                      title: "Default Title",
                      selectedOptions: [{ name: "Title", value: "Default Title" }],
                    },
                  },
                ],
              },
            },
          },
        }),
        { status: 200, headers: { "Content-Type": "application/json" } },
      );

    const port = createShopifyProductSnapshotPort(
      { shopDomain: "rint-test-store.myshopify.com", accessToken: "shpat_test" },
      fetchImpl as typeof fetch,
    );

    const snapshot = await port.getProductSnapshot({
      ref: "2",
      url: "https://rint-test-store.myshopify.com/products/the-multi-location-snowboard",
    });

    expect(snapshot?.attributes).toEqual(["snowboard"]);
    expect(snapshot?.brand).toBe("rint-test-store");
  });

  it("reads Shopify string errors instead of leaking shopify_product_query_failed", async () => {
    expect(shopifyGraphqlErrorMessage({ errors: "Invalid API key or access token" })).toBe(
      "Invalid API key or access token",
    );
    expect(
      shopifyGraphqlErrorMessage({
        errors: [{ message: "Access denied for inventoryQuantity field." }],
      }),
    ).toBe("Access denied for inventoryQuantity field.");

    const fetchImpl = async (_url: string, init?: RequestInit) => {
      const headers = (init?.headers ?? {}) as Record<string, string>;
      expect(headers["User-Agent"]).toBe(SHOPIFY_ADMIN_USER_AGENT);
      return new Response(JSON.stringify({ errors: "Invalid API key or access token" }), {
        status: 401,
        headers: { "Content-Type": "application/json" },
      });
    };

    const port = createShopifyProductSnapshotPort(
      { shopDomain: "rint-test-store.myshopify.com", accessToken: "shpat_test" },
      fetchImpl as typeof fetch,
    );

    await expect(
      port.getProductSnapshot({
        ref: null,
        url: "https://rint-test-store.myshopify.com/products/the-collection-snowboard-liquid",
      }),
    ).rejects.toThrow("Invalid API key or access token");
  });

  it("keeps a product snapshot when GraphQL returns the node plus field-level errors", async () => {
    const fetchImpl = async () =>
      new Response(
        JSON.stringify({
          errors: [{ message: "Access denied for inventoryQuantity field." }],
          data: {
            productByHandle: {
              id: "gid://shopify/Product/9",
              title: "The Collection Snowboard: Liquid",
              priceRangeV2: { minVariantPrice: { amount: "749.95", currencyCode: "USD" } },
              variants: { edges: [] },
            },
          },
        }),
        { status: 200, headers: { "Content-Type": "application/json" } },
      );

    const port = createShopifyProductSnapshotPort(
      { shopDomain: "rint-test-store.myshopify.com", accessToken: "shpat_test" },
      fetchImpl as typeof fetch,
    );

    const snapshot = await port.getProductSnapshot({
      ref: null,
      url: "https://rint-test-store.myshopify.com/products/the-collection-snowboard-liquid",
    });

    expect(snapshot?.name).toBe("The Collection Snowboard: Liquid");
    expect(snapshot?.currentPrice).toBe(749.95);
  });
});
