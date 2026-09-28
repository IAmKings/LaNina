import { describe, expect, it } from "vitest";

import { adminRunsCursorFromSearch, adminRunsEndpoint } from "./cursor-allowlist";

/** 与 worker 侧 encodeCursor 同形态的合法 cursor（canonical UTC + UUID id）。 */
const VALID_CURSOR = '{"scheduledAt":"2026-09-11T03:30:00.000Z","id":"0b9e6c59-2f3a-4c8d-9e1f-2a3b4c5d6e7f"}';

describe("admin runs cursor allowlist", () => {
  it("keeps a well-formed issued cursor and forwards it encoded in the endpoint", () => {
    expect(adminRunsCursorFromSearch(`?cursor=${encodeURIComponent(VALID_CURSOR)}`)).toBe(VALID_CURSOR);
    expect(adminRunsEndpoint(`?cursor=${encodeURIComponent(VALID_CURSOR)}`)).toBe(
      `/api/admin/runs?cursor=${encodeURIComponent(VALID_CURSOR)}`,
    );
  });

  it("ignores a missing or empty cursor and falls back to the first page", () => {
    expect(adminRunsCursorFromSearch("")).toBeNull();
    expect(adminRunsCursorFromSearch("?cursor=")).toBeNull();
    expect(adminRunsEndpoint("?cursor=")).toBe("/api/admin/runs");
  });

  it.each([
    ["<script>alert(1)</script>", "HTML injection"],
    ["%22}%3Bdrop%20table", "URL-encoded payload"],
    ['{"scheduledAt":"2026-09-11T03:30:00.000Z","id":"bad id; drop table"}', "special characters in id"],
    ['{"scheduledAt":"2026-09-11T03:30:00.000Z","id":"x"}{"extra":"y"}', "trailing content"],
    ['{"scheduledAt":"2026-09-11T03:30:00.000Z","id":"x","extra":"y"}', "extra key"],
    ['{"scheduledAt":"2026-09-11T03:30:00.000Z"}', "missing id"],
    ['{"id":"x","scheduledAt":"2026-09-11T03:30:00.000Z"}', "reordered keys"],
    ["[]", "JSON array"],
    ['{"scheduledAt":"2026-13-01T00:00:00.000Z","id":"x"}', "impossible calendar date"],
    ['{"scheduledAt":"2026-09-11T03:30:00Z","id":"x"}', "non-canonical precision"],
  ])("ignores a malformed cursor: %s", (raw) => {
    const search = `?cursor=${encodeURIComponent(raw)}`;
    expect(adminRunsCursorFromSearch(search)).toBeNull();
    // 非法值不得进入请求 URL：一律回退首页 endpoint。
    expect(adminRunsEndpoint(search)).toBe("/api/admin/runs");
  });

  it("bounds the cursor id length to the server limit of 256 characters", () => {
    const withinLimit = `?cursor=${encodeURIComponent(
      `{"scheduledAt":"2026-09-11T03:30:00.000Z","id":"${"a".repeat(256)}"}`,
    )}`;
    const overLimit = `?cursor=${encodeURIComponent(
      `{"scheduledAt":"2026-09-11T03:30:00.000Z","id":"${"a".repeat(257)}"}`,
    )}`;
    expect(adminRunsCursorFromSearch(withinLimit)).not.toBeNull();
    expect(adminRunsCursorFromSearch(overLimit)).toBeNull();
    expect(adminRunsEndpoint(overLimit)).toBe("/api/admin/runs");
  });
});
