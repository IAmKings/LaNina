import { describe, expect, it } from "vitest";
import { parseRoniHtml } from "./noaa-roni";

/**
 * live 诊断探针：抓取 CPC 实时页面并用现行解析器求值，输出最新季节与 2026 行。
 * 归属 live 配置（默认套件排除）。用于来源健康调查（如 2026-09 的陈旧页面事件）。
 */
describe("NOAA RONI live probe", () => {
  it("parses the live CPC page and reports the latest season", async () => {
    const response = await fetch(
      "https://www.cpc.ncep.noaa.gov/products/analysis_monitoring/enso/roni/index.php",
      { headers: { "cache-control": "no-cache" } },
    );
    const html = await response.text();
    console.log("HTTP", response.status, "bytes", html.length);
    const values = parseRoniHtml(html);
    const latest = values.at(-1);
    console.log(
      "parsed total:", values.length,
      "| 最新季节:", `${latest?.year}/${latest?.season} = ${latest?.value} @ ${latest?.observedAt}`,
    );
    for (const value of values.filter((entry) => entry.year === 2026)) {
      console.log(`2026 ${value.season} = ${value.value} @ ${value.observedAt}`);
    }
    expect(values.length).toBeGreaterThan(0);
  });
});
