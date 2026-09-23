import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { AdminDailyPage } from "./AdminDailyPage";

/**
 * The page fetches its preflight projection after mount, so a static render is exactly the state a
 * publisher sees before any server data arrives: no targets, no gate verdicts and no publish
 * controls may be invented in the browser.
 */
describe("admin daily publication page before data arrives", () => {
  it("renders only the loading notice without publish controls", () => {
    const html = renderToStaticMarkup(createElement(AdminDailyPage, { briefDate: "2026-09-11" }));

    expect(html).toContain("正在取得每日判定预检信息…");
    expect(html).toContain("2026-09-11");
    expect(html).not.toContain("<form");
    expect(html).not.toContain("确认发布每日判定");
    expect(html).not.toContain("ENSO-CORE-01");
    expect(html).not.toMatch(/freeze|sha256|blockers/i);
  });

  it("uses an accessible notice panel with the admin section label", () => {
    const html = renderToStaticMarkup(createElement(AdminDailyPage, { briefDate: "2026-09-11" }));

    expect(html).toContain('class="notice-panel"');
    expect(html).toContain("研究后台 · 每日判定");
    expect(html).toContain("<h2>");
  });
});
