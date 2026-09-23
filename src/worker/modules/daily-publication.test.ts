import { describe, expect, it } from "vitest";

import { REQUIRED_DAILY_THESIS_IDS } from "../../domain/daily-brief";
import {
  DailyPublicationTargetError,
  DailyPublicationTargetModule,
  type CutoffThesisVersion,
  type DailyPublicationTargetRepository,
} from "./daily-publication";

const CUTOFF = "2026-09-10T22:30:00.000Z";

class FakeRepository implements DailyPublicationTargetRepository {
  constructor(private readonly versions: readonly CutoffThesisVersion[]) {}

  findCutoffVersions(): Promise<readonly CutoffThesisVersion[]> {
    return Promise.resolve(this.versions);
  }
}

function publishedVersions(overrides: Partial<Record<string, Partial<CutoffThesisVersion>>> = {}) {
  return REQUIRED_DAILY_THESIS_IDS.map((thesisId, index) => ({
    thesisId,
    thesisVersionId: `version-${index + 1}`,
    version: 2,
    status: "published" as const,
    isLatest: true,
    ...(overrides[thesisId] ?? {}),
  }));
}

function resolve(versions: readonly CutoffThesisVersion[]) {
  return new DailyPublicationTargetModule(new FakeRepository(versions)).resolve(CUTOFF);
}

describe("DailyPublicationTargetModule", () => {
  it("returns the six targets in stable product order when every rule holds", async () => {
    const resolution = await resolve(publishedVersions());

    expect(resolution.blockers).toEqual([]);
    expect(resolution.targets).toEqual(
      REQUIRED_DAILY_THESIS_IDS.map((thesisId, index) => ({
        thesisId,
        thesisVersionId: `version-${index + 1}`,
      })),
    );
  });

  it("reports a missing, duplicate or unknown thesis instead of publishing a partial day", async () => {
    const missing = await resolve(publishedVersions().filter((item) => item.thesisId !== "SHIP-EU-01"));
    expect(missing.targets).toBeNull();
    expect(missing.blockers).toEqual(["TARGET_MISSING:SHIP-EU-01"]);

    const duplicate = await resolve([
      ...publishedVersions(),
      { thesisId: "ENSO-CORE-01", thesisVersionId: "version-extra", version: 2, status: "published", isLatest: true },
    ]);
    expect(duplicate.blockers).toEqual(["TARGET_DUPLICATE:ENSO-CORE-01"]);

    const unknown = await resolve([
      ...publishedVersions(),
      { thesisId: "SUGAR-01", thesisVersionId: "version-sugar", version: 1, status: "published", isLatest: true },
    ]);
    expect(unknown.blockers).toEqual(["UNKNOWN_THESIS:SUGAR-01"]);
  });

  it("blocks an unpublished or superseded target version", async () => {
    const draft = await resolve(publishedVersions({ "RUBBER-TH-01": { status: "draft" } }));
    expect(draft.blockers).toEqual(["VERSION_NOT_PUBLISHED:RUBBER-TH-01"]);

    const stale = await resolve(publishedVersions({ "MAIZE-SA-01": { isLatest: false } }));
    expect(stale.blockers).toEqual(["VERSION_NOT_LATEST:MAIZE-SA-01"]);
  });

  it("refuses a malformed cutoff before consulting storage", async () => {
    const repository = new FakeRepository(publishedVersions());
    const module = new DailyPublicationTargetModule(repository);

    await expect(module.resolve("2026-09-10T22:30:00Z"))
      .rejects.toBeInstanceOf(DailyPublicationTargetError);
    await expect(module.resolve("2026-09-10T22:30:00Z"))
      .rejects.toMatchObject({ code: "VALIDATION" });
  });
});
