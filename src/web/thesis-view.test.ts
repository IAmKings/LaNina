import { describe, expect, it } from "vitest";

import { evidenceQualityLabel, evidenceStanceLabel, transmissionStages } from "./thesis-view";

describe("thesis detail view helpers", () => {
  it("keeps the transmission taxonomy readable while marking only the Worker-provided stage", () => {
    expect(transmissionStages("physical_pressure")).toEqual(expect.arrayContaining([
      { id: "weather_realized", label: "区域天气", current: false },
      { id: "physical_pressure", label: "实物", current: true },
      { id: "market_confirmed", label: "市场", current: false },
    ]));
  });

  it("labels evidence stance, quality and revisions without treating confidence as a price probability", () => {
    expect(evidenceStanceLabel("supports")).toBe("支持证据");
    expect(evidenceStanceLabel("refutes")).toBe("反向证据");
    expect(evidenceQualityLabel("provisional", 2)).toBe("暂定 · 修订 2");
  });
});
