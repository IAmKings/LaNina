import { describe, expect, it } from "vitest";

import { THESIS_DIRECTIONS, THESIS_STAGES } from "./contracts";

describe("domain contracts", () => {
  it("keeps the approved thesis state machine order", () => {
    expect(THESIS_STAGES).toEqual([
      "watch",
      "weather_realized",
      "physical_pressure",
      "balance_tightening",
      "market_confirmed",
      "easing",
    ]);
  });

  it("keeps directions distinct from trading instructions", () => {
    expect(THESIS_DIRECTIONS).toEqual(["bullish", "bearish", "neutral", "mixed"]);
  });
});
