import { describe, expect, it, vi } from "vitest";

import {
  isPublicDailyBriefDate,
  PublicDailyBriefModule,
  type PublicDailyBriefRepository,
} from "./public-daily-briefs";

describe("PublicDailyBriefModule", () => {
  it("accepts only real calendar dates before calling its repository", async () => {
    const repository: PublicDailyBriefRepository = { findPublished: vi.fn(async () => null) };
    const module = new PublicDailyBriefModule(repository);

    await expect(module.findPublished("2026-02-29")).rejects.toMatchObject({ name: "PublicDailyBriefError" });
    await expect(module.findPublished("2026-2-28")).rejects.toMatchObject({ name: "PublicDailyBriefError" });
    expect(repository.findPublished).not.toHaveBeenCalled();

    await expect(module.findPublished("2028-02-29")).resolves.toBeNull();
    expect(repository.findPublished).toHaveBeenCalledWith("2028-02-29");
  });

  it("keeps the route-level date guard deterministic", () => {
    expect(isPublicDailyBriefDate("2026-09-10")).toBe(true);
    expect(isPublicDailyBriefDate("2026-09-31")).toBe(false);
    expect(isPublicDailyBriefDate("2026-09-10T00:00:00.000Z")).toBe(false);
  });
});
