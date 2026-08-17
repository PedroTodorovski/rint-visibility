import { describe, expect, it } from "vitest";

import { resolveGroundingUrl, resolveGroundingUrls } from "../src/lib/grounding-resolve.js";

describe("resolveGroundingUrls", () => {
  it("keeps a normal host without fetching", async () => {
    const row = await resolveGroundingUrl("https://www.decathlon.com.br/snowboard", async () => {
      throw new Error("should not fetch");
    });
    expect(row.host).toBe("decathlon.com.br");
    expect(row.to).toBe("https://www.decathlon.com.br/snowboard");
  });

  it("follows a Vertex grounding redirect and stores the final host", async () => {
    const row = await resolveGroundingUrl(
      "https://vertexaisearch.cloud.google.com/grounding-api-redirect/abc",
      async () => {
        const response = new Response("", { status: 200 });
        Object.defineProperty(response, "url", {
          value: "https://www.decathlon.com.br/snowboard",
        });
        return response;
      },
    );
    expect(row.host).toBe("decathlon.com.br");
    expect(row.to).toBe("https://www.decathlon.com.br/snowboard");
  });

  it("does not treat an unresolved Google redirect as a client host", async () => {
    const rows = await resolveGroundingUrls(
      ["https://vertexaisearch.cloud.google.com/grounding-api-redirect/abc"],
      async () => new Response("", { status: 200 }),
    );
    expect(rows[0]?.host).toBeNull();
  });
});
