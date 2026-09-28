import { describe, expect, it } from "vitest";
import { compareSelectedLatestFirst, compareText, sortedLayers } from "./compare";
import type { SelectedEvidence } from "../evaluation";
import { deepFreeze } from "./freeze";
import { parseCanonicalUtc } from "./time";

describe("internal/deepFreeze", () => {
  it("freezes nested structures and returns the same reference", () => {
    const value = { a: { b: [1, { c: 2 }] } };
    const frozen = deepFreeze(value);
    expect(frozen).toBe(value);
    expect(Object.isFrozen(frozen)).toBe(true);
    expect(Object.isFrozen(frozen.a)).toBe(true);
    expect(Object.isFrozen(frozen.a.b)).toBe(true);
    expect(Object.isFrozen(frozen.a.b[1])).toBe(true);
  });

  it("does not descend into already-frozen subtrees", () => {
    const grandchild = { z: 3 };
    const frozenChild = Object.freeze({ y: grandchild });
    const value = deepFreeze({ a: frozenChild });
    expect(Object.isFrozen(value)).toBe(true);
    expect(Object.isFrozen(frozenChild)).toBe(true);
    expect(Object.isFrozen(grandchild)).toBe(false);
  });

  it("terminates on cyclic references", () => {
    const value: Record<string, unknown> = { name: "root" };
    value.self = value;
    expect(() => deepFreeze(value)).not.toThrow();
    expect(Object.isFrozen(value)).toBe(true);
  });

  it("leaves primitives and shared object identity intact", () => {
    expect(deepFreeze(3)).toBe(3);
    expect(deepFreeze(null)).toBe(null);
    const shared = { n: 1 };
    const value = deepFreeze({ first: shared, second: shared });
    expect(value.first).toBe(value.second);
  });
});

describe("internal/compare", () => {
  it("compares strings by deterministic ASCII order", () => {
    expect(compareText("a", "b")).toBe(-1);
    expect(compareText("b", "a")).toBe(1);
    expect(compareText("same", "same")).toBe(0);
    expect(["b", "a", "c"].sort(compareText)).toEqual(["a", "b", "c"]);
  });

  it("sorts layers in the canonical evidence-layer order", () => {
    expect(sortedLayers(["market", "weather", "forecast"])).toEqual(["forecast", "weather", "market"]);
  });

  it("keeps duplicates while sorting (dedupe variant was unreachable-equivalent)", () => {
    expect(sortedLayers(["weather", "market", "weather"])).toEqual(["weather", "weather", "market"]);
  });

  it("orders selected evidence latest-observed then latest-revision first", () => {
    const base: SelectedEvidence = {
      evidenceId: "e",
      observationId: null,
      sourceRunId: null,
      revision: 0,
      supersedesId: null,
      indicatorId: "i",
      sourceId: "s",
      layer: "weather",
      stance: "supports",
      weight: 1,
      observedAt: "2026-09-08T09:00:00.000Z",
      publishedAt: null,
      fetchedAt: "2026-09-08T10:00:00.000Z",
      value: 1,
      unit: "x",
      quality: "verified",
      citationUrl: "https://x",
      sourceTier: "A",
      sourceHealth: "healthy",
      freshness: "fresh",
      selectorId: "sel",
      selectionReason: "r",
    };
    const evidence = (overrides: Partial<SelectedEvidence>): SelectedEvidence => ({ ...base, ...overrides });
    const older = evidence({ evidenceId: "older", observedAt: "2026-09-07T09:00:00.000Z" });
    const newer = evidence({ evidenceId: "newer", observedAt: "2026-09-08T09:00:00.000Z" });
    const newerRevision = evidence({ evidenceId: "rev1", revision: 1 });
    const newerRevision0 = evidence({ evidenceId: "rev0", revision: 0 });
    expect(compareSelectedLatestFirst(newer, older)).toBeLessThan(0);
    expect(compareSelectedLatestFirst(newerRevision, newerRevision0)).toBeLessThan(0);
    expect(compareSelectedLatestFirst(evidence({ evidenceId: "a" }), evidence({ evidenceId: "b" }))).toBeLessThan(0);
  });
});

describe("internal/time", () => {
  it("accepts millisecond-precision UTC instants and round-trips them", () => {
    expect(parseCanonicalUtc("2026-09-08T12:00:00.000Z")).toBe(Date.parse("2026-09-08T12:00:00.000Z"));
  });

  it("rejects non-canonical shapes and impossible calendar dates", () => {
    expect(parseCanonicalUtc("2026-09-08T12:00:00Z")).toBe(null);
    expect(parseCanonicalUtc("2026-09-08T12:00:00.000+08:00")).toBe(null);
    expect(parseCanonicalUtc("2026-02-30T00:00:00.000Z")).toBe(null);
    expect(parseCanonicalUtc("not-a-time")).toBe(null);
  });
});
