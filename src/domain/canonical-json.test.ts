import { describe, expect, it } from "vitest";
import { canonicalJson, sha256Hex } from "./canonical-json";

describe("canonicalJson", () => {
  it("sorts object keys while preserving arrays and shared non-cyclic references", () => {
    const shared = { z: 2, a: 1 };

    expect(canonicalJson({ right: shared, left: shared, list: [2, 1] })).toBe(
      '{"left":{"a":1,"z":2},"list":[2,1],"right":{"a":1,"z":2}}',
    );
  });

  it.each([
    ["undefined object value", { value: undefined }],
    ["undefined array value", [undefined]],
    ["NaN", { value: Number.NaN }],
    ["positive infinity", { value: Number.POSITIVE_INFINITY }],
    ["negative zero", { value: -0 }],
    ["non-plain Date", { value: new Date("2026-09-08T00:00:00.000Z") }],
    ["non-plain Map", { value: new Map() }],
  ])("rejects %s", (_label, value) => {
    expect(() => canonicalJson(value)).toThrow(TypeError);
  });

  it("rejects sparse arrays, cycles and symbol keys", () => {
    const sparse = new Array(1);
    const cyclic: Record<string, unknown> = {};
    cyclic.self = cyclic;
    const symbolKey = { visible: true } as Record<PropertyKey, unknown>;
    symbolKey[Symbol("private")] = true;

    expect(() => canonicalJson(sparse)).toThrow(/sparse/);
    expect(() => canonicalJson(cyclic)).toThrow(/cycle/);
    expect(() => canonicalJson(symbolKey)).toThrow(/symbol key/);
  });

  it("produces a lowercase 64-character SHA-256 digest", async () => {
    await expect(sha256Hex("abc")).resolves.toBe(
      "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad",
    );
  });
});
