import { describe, expect, it } from "vitest";

import { formatShanghaiDayMonth, formatShanghaiTime } from "./shanghai-time";

/**
 * Locks the cached formatter's output to the exact strings the per-call construction produced
 * before the module-level cache existed (previously asserted via overview-view and the overview
 * presentation tests). The option objects must stay byte-identical to that legacy behavior.
 */
function legacyFormatShanghaiTime(value: string): string {
  return new Intl.DateTimeFormat("zh-CN", {
    day: "2-digit",
    hour: "2-digit",
    hour12: false,
    minute: "2-digit",
    month: "2-digit",
    timeZone: "Asia/Shanghai",
    year: "numeric",
  }).format(new Date(value));
}

function legacyFormatShanghaiDayMonth(value: Date): string {
  return new Intl.DateTimeFormat("zh-CN", {
    day: "2-digit",
    month: "2-digit",
    timeZone: "Asia/Shanghai",
  }).format(value);
}

describe("shanghai time formatting", () => {
  it("formats known public timestamps exactly like the legacy per-call formatter", () => {
    const knownTimes = [
      "2026-09-09T23:00:00.000Z",
      "2026-09-09T22:30:00.000Z",
      "2026-09-09T16:00:01.000Z",
      "2026-09-14T00:30:00.000Z",
      "2026-01-01T12:00:00.000Z",
    ];
    for (const knownTime of knownTimes) {
      expect(formatShanghaiTime(knownTime)).toBe(legacyFormatShanghaiTime(knownTime));
    }

    expect(formatShanghaiTime("2026-09-09T23:00:00.000Z")).toBe("2026/09/10 07:00");
    expect(formatShanghaiTime("2026-09-09T22:30:00.000Z")).toBe("2026/09/10 06:30");
    expect(formatShanghaiTime("2026-09-09T16:00:01.000Z")).toBe("2026/09/10 00:00");
  });

  it("keeps a missing timestamp an explicit 暂无 instead of a fabricated time", () => {
    expect(formatShanghaiTime(null)).toBe("暂无");
  });

  it("renders chart axis day/month labels with the same cached time zone", () => {
    const observedAt = new Date("2026-09-01T00:00:00.000Z");
    expect(formatShanghaiDayMonth(observedAt)).toBe(legacyFormatShanghaiDayMonth(observedAt));
    expect(formatShanghaiDayMonth(new Date("2026-12-31T16:00:00.000Z"))).toBe("01/01");
    expect(formatShanghaiDayMonth(new Date("2026-09-01T00:00:00.000Z"))).toBe("09/01");
  });
});
