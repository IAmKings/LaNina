import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

import { renderAtomFeed } from "../worker/modules/atom-feed";
import {
  demoAtomFeed,
  demoCategoryPages,
  demoThesisCards,
  demoThesisPages,
} from "./local-demo-fixtures";

function sourceFiles(dir) {
  return readdirSync(dir).flatMap((entry) => {
    const path = join(dir, entry);
    if (statSync(path).isDirectory()) return sourceFiles(path);
    return /\.(ts|tsx)$/.test(entry) ? [path] : [];
  });
}

describe("local demo fixtures", () => {
  it("uses the product slugs so the demo matches the seeded local database", () => {
    const slugs = demoThesisCards().map((card) => card.slug);
    expect(slugs).toContain("thailand-natural-rubber");
    expect(slugs).toContain("enso-core");
    expect(slugs).not.toContain("thailand-rubber");
  });

  it("covers all six theses, all three market categories and every detail route", () => {
    const cards = demoThesisCards();
    expect(cards).toHaveLength(6);
    expect(new Set(cards.map((card) => card.id)).size).toBe(6);
    expect(new Set(cards.map((card) => card.slug)).size).toBe(6);

    const categories = demoCategoryPages();
    expect(categories.map((page) => page.category)).toEqual(["rubber", "agriculture", "shipping"]);
    for (const page of categories) {
      expect(page.theses.length).toBeGreaterThan(0);
      // Every card on a category page must be reachable, or the page links to an empty route.
      for (const thesis of page.theses) expect(thesis.category).toBe(page.category);
    }

    const pages = demoThesisPages();
    expect(pages.map((page) => page.thesis.slug).sort()).toEqual(cards.map((card) => card.slug).sort());
  });

  it("spreads the demo theses across transmission stages without inventing a score", () => {
    const stages = new Set(demoThesisCards().map((card) => card.stage));
    expect(stages.size).toBeGreaterThanOrEqual(4);
    expect(stages.has("watch")).toBe(true);
    expect(stages.has("market_confirmed")).toBe(true);
    for (const card of demoThesisCards()) {
      expect(card.confidence).toBeGreaterThanOrEqual(0);
      expect(card.confidence).toBeLessThanOrEqual(100);
    }
  });

  it("marks derived pages as synthetic copy instead of reusing another thesis's evidence", () => {
    const palm = demoThesisPages().find((page) => page.thesis.slug === "southeast-asia-palm-oil");
    expect(palm).toBeDefined();
    expect(palm.supportingEvidence[0].summary).toContain("合成演示");
    expect(palm.counterEvidence[0].summary).toContain("合成演示");
    expect(palm.indicators[0].name).toContain("合成演示");
    expect(palm.invalidation).toContain("合成演示");
    // The two shipped fixture theses keep their original detail copy.
    const rubber = demoThesisPages().find((page) => page.thesis.slug === "thailand-natural-rubber");
    expect(rubber.supportingEvidence[0].summary).not.toContain("合成演示");
  });

  it("renders a non-empty Atom feed through the real renderer", () => {
    const xml = renderAtomFeed(demoAtomFeed(), "https://demo.example.test", "2026-09-10T00:00:00.000Z");

    expect(xml).toContain("<entry>");
    expect(xml).toContain("重大变化：泰国天然橡胶");
    expect(xml).toContain("每日判定：ENSO 风险仍待实物与市场层确认");
    expect(xml).toContain("https://demo.example.test/feed.xml#change-");
  });

  it("is imported only by the Vite demo configuration, never by app or Worker code", () => {
    const offenders = [...sourceFiles("src/web"), ...sourceFiles("src/worker")]
      .filter((path) => readFileSync(path, "utf8").includes("local-demo-fixtures"));

    expect(offenders).toEqual([]);
  });
});
