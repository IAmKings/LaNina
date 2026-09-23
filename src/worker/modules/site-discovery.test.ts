import { describe, expect, it } from "vitest";

import { robotsResponse, sitemapResponse } from "./site-discovery";

describe("site discovery documents", () => {
  it("lists only fixed public SPA pages using the request origin", async () => {
    const response = sitemapResponse("https://preview.example.test");
    const body = await response.text();

    expect(response.headers.get("content-type")).toBe("application/xml; charset=utf-8");
    expect(response.headers.get("cache-control")).toBe("public, max-age=300, stale-while-revalidate=300");
    expect(body).toContain("https://preview.example.test/shipping");
    expect(body).toContain("https://preview.example.test/methodology");
    expect(body).not.toMatch(/admin|api|theses|draft|snapshot|source_run/i);
  });

  it("blocks crawlers from API and admin paths while naming the canonical sitemap", async () => {
    const response = robotsResponse("https://preview.example.test");

    expect(response.headers.get("content-type")).toBe("text/plain; charset=utf-8");
    await expect(response.text()).resolves.toBe([
      "User-agent: *",
      "Allow: /",
      "Disallow: /api/",
      "Disallow: /admin/",
      "Sitemap: https://preview.example.test/sitemap.xml",
      "",
    ].join("\n"));
  });

  it("rejects non-origin URLs instead of producing attacker-controlled canonical links", () => {
    expect(() => sitemapResponse("https://example.test/path")).toThrow("站点来源无效");
    expect(() => robotsResponse("ftp://example.test")).toThrow("站点来源无效");
  });
});
