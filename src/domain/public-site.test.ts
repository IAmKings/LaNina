import { describe, expect, it } from "vitest";

import { PUBLIC_SITEMAP_PATHS, publicPageMetadata } from "./public-site";

describe("public site metadata", () => {
  it("keeps the sitemap limited to stable public SPA pages", () => {
    expect(PUBLIC_SITEMAP_PATHS).toEqual([
      "/",
      "/rubber",
      "/agriculture",
      "/shipping",
      "/changes",
      "/data-health",
      "/methodology",
    ]);
    expect(PUBLIC_SITEMAP_PATHS).not.toContain("/admin/runs");
    expect(PUBLIC_SITEMAP_PATHS).not.toContain("/theses/thailand-rubber");
  });

  it("provides public metadata but excludes private and malformed paths", () => {
    expect(publicPageMetadata("/shipping")).toMatchObject({ title: expect.stringContaining("航运") });
    expect(publicPageMetadata("/theses/thailand-rubber")).toMatchObject({
      title: "thailand rubber 影响论点详情 | ENSO 市场影响监测",
      description: expect.stringContaining("thailand rubber"),
    });
    expect(publicPageMetadata("/admin/runs")).toBeNull();
    expect(publicPageMetadata("/theses/Draft-Only")).toBeNull();
  });
});
