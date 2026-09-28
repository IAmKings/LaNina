import { describe, expect, it } from "vitest";

import { pageMetadata } from "./seo";

describe("SEO page metadata", () => {
  it("uses a unique public title and description for stable routes", () => {
    const rubber = pageMetadata({ origin: "https://preview.example.test", pathname: "/rubber" });
    const shipping = pageMetadata({ origin: "https://preview.example.test", pathname: "/shipping" });

    expect(rubber.title).not.toBe(shipping.title);
    expect(rubber.description).not.toBe(shipping.description);
    expect(rubber.robots).toBe("index, follow");
  });

  it("derives canonical URLs from the current browser origin and keeps private pages out of search", () => {
    expect(pageMetadata({ origin: "https://preview.example.test", pathname: "/changes" })).toMatchObject({
      canonical: "https://preview.example.test/changes",
      robots: "index, follow",
    });
    expect(pageMetadata({ origin: "https://preview.example.test", pathname: "/admin/runs" })).toMatchObject({
      canonical: "https://preview.example.test/admin/runs",
      robots: "noindex, nofollow",
    });
    expect(pageMetadata({ origin: "https://preview.example.test", pathname: "/admin/daily/2026-09-11" })).toMatchObject({
      canonical: "https://preview.example.test/admin/daily/2026-09-11",
      robots: "noindex, nofollow",
    });
  });

  it("describes unknown paths as the 404 page that actually renders, while admin screens keep their own metadata", () => {
    for (const pathname of ["/foo", "/Rubber", "/theses/ABC", "/admin/unknown"]) {
      expect(pageMetadata({ origin: "https://preview.example.test", pathname })).toMatchObject({
        canonical: `https://preview.example.test${pathname}`,
        title: "页面不存在 | ENSO 市场影响监测",
        robots: "noindex, nofollow",
      });
    }

    // App.tsx 对 /admin/unknown 渲染的是 NotFoundPage；只有真正渲染后台界面的路径
    // （判定与 App.tsx 同源，见 paths.ts）才使用「研究后台」元数据。
    for (const pathname of ["/admin", "/admin/runs", "/admin/daily", "/admin/daily/2026-09-11", "/admin/theses/ENSO-CORE-01/draft"]) {
      expect(pageMetadata({ origin: "https://preview.example.test", pathname }).title).toContain("研究后台");
    }
  });
});
