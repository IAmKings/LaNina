import { describe, expect, it } from "vitest";

import { renderAtomFeed } from "./atom-feed";

describe("renderAtomFeed", () => {
  it("escapes public text and orders entries deterministically", () => {
    const xml = renderAtomFeed({
      changes: [{
        id: "change<&'\"",
        type: "thesis",
        thesisId: "RUBBER-TH-01",
        thesisTitle: "橡胶 <更新> & 复核",
        summary: "公开 <摘要> & 保留",
        beforeLabel: null,
        afterLabel: "确认 '上涨' \"窗口\"",
        detectedAt: "2026-09-10T01:00:00.000Z",
        publishedInCurrentThesis: true,
        source: null,
      }],
      dailyBriefs: [{
        briefDate: "2026-09-10",
        headline: "每日 & 判定",
        summary: "摘要 <不应成为标签>",
        dataCutoff: "2026-09-09T22:30:00.000Z",
        publishedAt: "2026-09-10T02:00:00.000Z",
      }],
    }, "https://monitor.example.test", "2026-09-10T03:00:00.000Z");

    expect(xml).toContain("每日判定：每日 &amp; 判定");
    expect(xml).toContain("橡胶 &lt;更新&gt; &amp; 复核");
    expect(xml).toContain("确认 &apos;上涨&apos; &quot;窗口&quot;");
    expect(xml).not.toContain("<不应成为标签>");
    expect(xml.indexOf("#daily-2026-09-10")).toBeLessThan(xml.indexOf("#change-change"));
  });

  it("returns a valid entry-free document when no public item is available", () => {
    const xml = renderAtomFeed(
      { changes: [], dailyBriefs: [] },
      "https://monitor.example.test",
      "2026-09-10T03:00:00.000Z",
    );

    expect(xml).toContain("<updated>2026-09-10T03:00:00.000Z</updated>");
    expect(xml).not.toContain("<entry>");
    expect(xml).not.toMatch(/draft|snapshot|audit|raw/i);
  });
});
