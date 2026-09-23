import { describe, expect, it } from "vitest";

import { isAdminThesisId, parseAdminRunsCursor } from "./admin-read-models";

describe("admin run cursor", () => {
  it("accepts only the bounded opaque scheduled-time and identifier cursor", () => {
    expect(parseAdminRunsCursor(JSON.stringify({ scheduledAt: "2026-09-09T12:00:00.000Z", id: "run-1" })))
      .toEqual({ scheduledAt: "2026-09-09T12:00:00.000Z", id: "run-1" });
    expect(parseAdminRunsCursor(JSON.stringify({ scheduledAt: "2026-09-09T12:00:00Z", id: "run-1" }))).toBeNull();
    expect(parseAdminRunsCursor(JSON.stringify({ scheduledAt: "2026-09-09T12:00:00.000Z", id: "run-1", sourceId: "x" }))).toBeNull();
    expect(parseAdminRunsCursor("not-json")).toBeNull();
  });
});

describe("admin thesis identity", () => {
  it("accepts only bounded path-safe thesis identities", () => {
    expect(isAdminThesisId("RUBBER-TH-01")).toBe(true);
    expect(isAdminThesisId("enso_core_01")).toBe(true);
    expect(isAdminThesisId("private/thesis")).toBe(false);
    expect(isAdminThesisId(" thesis")).toBe(false);
  });
});
