import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

import { contrastRatio, parseOpaqueHexColor, relativeLuminance } from "./color-contrast";

const ROOT = new globalThis.URL("../../", import.meta.url);
const STYLESHEET = readFileSync(new globalThis.URL("src/web/styles.css", ROOT), "utf8");
const AA_NORMAL_TEXT_RATIO = 4.5;
const NON_TEXT_FOCUS_RATIO = 3;

/**
 * Opaque foreground/background pairs deliberately owned by the referenced CSS selectors.
 * Translucent panels, backdrop-filtered navigation, the body radial gradient and image/canvas
 * surfaces are excluded: their composited result needs the staged viewport visual acceptance.
 */
const OPAQUE_TEXT_PAIRS = [
  { name: "base text", selector: ":root", foreground: "#17201e", background: "#f4f1e8" },
  { name: "navigation link", selector: "nav a", foreground: "#52605b", background: "#f4f1e8" },
  { name: "current navigation link", selector: 'nav a[aria-current="page"]', backgroundSelector: "nav a", foreground: "#174c39", background: "#f4f1e8" },
  { name: "skip link", selector: ".skip-link", foreground: "#ffffff", foregroundCss: "#fff", background: "#174c39" },
  { name: "brief primary at first gradient endpoint", selector: ".brief-panel", foreground: "#fcfaf4", background: "#1b4f3b" },
  { name: "brief primary at second gradient endpoint", selector: ".brief-panel", foreground: "#fcfaf4", background: "#28654d" },
  { name: "brief meta at first gradient endpoint", selector: ".brief-panel .eyebrow", backgroundSelector: ".brief-panel", foreground: "#d1e8d9", background: "#1b4f3b" },
  { name: "brief meta at second gradient endpoint", selector: ".brief-panel .eyebrow", backgroundSelector: ".brief-panel", foreground: "#d1e8d9", background: "#28654d" },
  { name: "stale banner", selector: ".stale-banner", foreground: "#604812", background: "#fff4d4" },
  { name: "bullish direction", selector: ".direction.bullish", foreground: "#155940", background: "#d9ecdf" },
  { name: "bearish direction", selector: ".direction.bearish", foreground: "#8b3630", background: "#f5dfdc" },
  { name: "mixed direction", selector: ".direction.mixed", foreground: "#5e521a", background: "#f1e9bd" },
  { name: "healthy source status", selector: ".health-status.healthy", backgroundSelector: ".health-status", foreground: "#155940", background: "#fffdf7" },
  { name: "stale source status", selector: ".health-status.stale", backgroundSelector: ".health-status", foreground: "#7c6514", background: "#fffdf7" },
  { name: "unavailable source status", selector: ".health-status.unavailable", backgroundSelector: ".health-status", foreground: "#8b3630", background: "#fffdf7" },
  { name: "primary admin action", selector: ".admin-action-button", foreground: "#fffdf7", background: "#174c39" },
  { name: "danger admin action", selector: ".admin-action-button.is-danger", foregroundSelector: ".admin-action-button", foreground: "#fffdf7", background: "#8b3630" },
  { name: "secondary admin action", selector: ".admin-lifecycle-actions button:not(.admin-action-button)", foreground: "#174c39", background: "#fffdf7" },
  { name: "successful admin run status", selector: ".admin-run-status", foreground: "#174c39", background: "#fffdf7" },
  { name: "failed admin run status", selector: ".admin-run-status.failed", backgroundSelector: ".admin-run-status", foreground: "#9a3020", background: "#fffdf7" },
  { name: "partial admin run status", selector: ".admin-run-status.partial", backgroundSelector: ".admin-run-status", foreground: "#865f0b", background: "#fffdf7" },
];

describe("opaque color contrast", () => {
  it("uses the WCAG sRGB luminance algorithm", () => {
    expect(relativeLuminance(parseOpaqueHexColor("#000000"))).toBe(0);
    expect(relativeLuminance(parseOpaqueHexColor("#ffffff"))).toBe(1);
    expect(contrastRatio("#000000", "#ffffff")).toBe(21);
    expect(contrastRatio("#767676", "#ffffff")).toBeCloseTo(4.542, 3);
  });

  it("accepts only explicit opaque six-digit hex colors", () => {
    expect(parseOpaqueHexColor("#1b4f3b")).toEqual({ red: 27, green: 79, blue: 59 });
    for (const value of ["#fff", "#1b4f3bff", "rgb(27 79 59)", "#1b4f3", " #1b4f3b", "#gg4f3b"]) {
      expect(() => parseOpaqueHexColor(value)).toThrow("opaque #RRGGBB");
    }
  });

  it("keeps representative opaque text and state combinations at WCAG AA", () => {
    for (const pair of OPAQUE_TEXT_PAIRS) {
      expect(cssRule(pair.foregroundSelector ?? pair.selector), `${pair.name} foreground selector`).toContain(pair.foregroundCss ?? pair.foreground);
      expect(cssRule(pair.backgroundSelector ?? pair.selector), `${pair.name} background selector`).toContain(pair.background);
      expect(contrastRatio(pair.foreground, pair.background), pair.name).toBeGreaterThanOrEqual(AA_NORMAL_TEXT_RATIO);
    }
  });

  it("keeps the two-tone keyboard focus ring visible on both light and dark opaque surfaces", () => {
    for (const selector of ["a:focus-visible", "button:focus-visible", "textarea:focus-visible", "input:focus-visible"]) {
      const focusRule = cssRule(selector);
      expect(focusRule, `${selector} outline`).toContain("outline: 3px solid #174c39");
      expect(focusRule, `${selector} outer ring`).toContain("box-shadow: 0 0 0 7px #f4f1e8");
    }

    // The dark outline is visible against the light canvas; the light outer ring is visible
    // around a dark primary action. Both checks intentionally cover opaque surfaces only.
    expect(contrastRatio("#174c39", "#f4f1e8"), "outline on light surface").toBeGreaterThanOrEqual(NON_TEXT_FOCUS_RATIO);
    expect(contrastRatio("#f4f1e8", "#174c39"), "outer ring on dark surface").toBeGreaterThanOrEqual(NON_TEXT_FOCUS_RATIO);
  });
});

function cssRule(selector) {
  const declarations = [];
  for (const match of STYLESHEET.matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
    const selectors = match[1].split(",").map((item) => item.trim());
    if (selectors.includes(selector)) declarations.push(match[2]);
  }
  if (declarations.length === 0) throw new Error(`Missing stylesheet selector: ${selector}`);
  return declarations.join("\n");
}
