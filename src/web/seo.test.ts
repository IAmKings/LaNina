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
});
