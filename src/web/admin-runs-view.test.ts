import { describe, expect, it } from "vitest";

import { PAGE_MODEL_FIXTURES } from "../domain/page-models.fixtures";
import { adminRunStatusLabel, hasAdminRuns, safeErrorCodeLabel } from "./admin-runs-view";

describe("admin runs view helpers", () => {
  it("keeps an empty authenticated result distinct from a populated run list", () => {
    expect(hasAdminRuns(PAGE_MODEL_FIXTURES.adminRuns)).toBe(true);
    expect(hasAdminRuns({ ...PAGE_MODEL_FIXTURES.adminRuns, runs: [] })).toBe(false);
  });

  it("uses explicit labels for all run states and only safe error codes", () => {
    expect(adminRunStatusLabel("success")).toBe("成功");
    expect(adminRunStatusLabel("unchanged")).toBe("无变化");
    expect(adminRunStatusLabel("partial")).toBe("部分完成");
    expect(adminRunStatusLabel("failed")).toBe("失败");
    expect(safeErrorCodeLabel(null)).toBe("无");
    expect(safeErrorCodeLabel("NETWORK")).toBe("NETWORK");
  });
});
