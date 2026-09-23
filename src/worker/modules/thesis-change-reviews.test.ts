import { describe, expect, it } from "vitest";

import {
  ThesisChangeReviewError,
  ThesisChangeReviewModule,
  type ThesisChangeReviewRecord,
  type ThesisChangeReviewRepository,
} from "./thesis-change-reviews";

const ACTOR = "publisher@example.test";
const OCCURRED_AT = "2026-09-11T00:00:00.000Z";

class FakeRepository implements ThesisChangeReviewRepository {
  readonly stored: ThesisChangeReviewRecord[] = [];
  previous: string | null = "version-1";
  statuses = new Map<string, "draft" | "published">([["version-2", "draft"]]);

  findPreviousFrozenVersion(): Promise<string | null> {
    return Promise.resolve(this.previous);
  }

  findReviewableVersionStatus(thesisId: string, versionId: string): Promise<"draft" | "published" | null> {
    if (thesisId !== "ENSO-CORE-01") return Promise.resolve(null);
    return Promise.resolve(this.statuses.get(versionId) ?? null);
  }

  find(afterVersionId: string): Promise<ThesisChangeReviewRecord | null> {
    return Promise.resolve(this.stored.find((row) => row.afterVersionId === afterVersionId) ?? null);
  }

  insert(record: ThesisChangeReviewRecord): Promise<ThesisChangeReviewRecord> {
    const existing = this.stored.find((row) => row.afterVersionId === record.afterVersionId);
    if (existing !== undefined) return Promise.resolve(existing);
    this.stored.push(record);
    return Promise.resolve(record);
  }
}

function command(overrides: Partial<Parameters<ThesisChangeReviewModule["record"]>[0]> = {}) {
  return {
    thesisId: "ENSO-CORE-01",
    afterVersionId: "version-2",
    beforeVersionId: "version-1",
    decision: "approved" as const,
    reason: "方向变化已由研究负责人复核",
    actor: ACTOR,
    occurredAt: OCCURRED_AT,
    ...overrides,
  };
}

describe("ThesisChangeReviewModule", () => {
  it("stores an approved review bound to the exact previous and target version", async () => {
    const repository = new FakeRepository();
    const review = await new ThesisChangeReviewModule(repository).record(command());

    expect(review).toEqual({
      thesisId: "ENSO-CORE-01",
      afterVersionId: "version-2",
      beforeVersionId: "version-1",
      decision: "approved",
      reviewedBy: ACTOR,
      reviewedAt: OCCURRED_AT,
      reason: "方向变化已由研究负责人复核",
    });
    expect(Object.isFrozen(review)).toBe(true);
    expect(repository.stored).toHaveLength(1);
  });

  it("is idempotent for an identical retry and never rewrites the stored decision", async () => {
    const repository = new FakeRepository();
    const module = new ThesisChangeReviewModule(repository);
    const first = await module.record(command());
    const second = await module.record(command({ occurredAt: "2026-09-11T01:00:00.000Z" }));

    expect(second).toEqual(first);
    expect(repository.stored).toHaveLength(1);
    expect(repository.stored[0]!.reviewedAt).toBe(OCCURRED_AT);
  });

  it("refuses a different decision for a version that already has one", async () => {
    const repository = new FakeRepository();
    const module = new ThesisChangeReviewModule(repository);
    await module.record(command());

    await expect(module.record(command({ decision: "rejected", reason: "复核后拒绝" })))
      .rejects.toMatchObject({ code: "VERSION_CONFLICT" });
    await expect(module.record(command({ reason: "换了理由" })))
      .rejects.toMatchObject({ code: "VERSION_CONFLICT" });
    expect(repository.stored).toHaveLength(1);
  });

  it("refuses a before version that is not the last frozen daily-brief version", async () => {
    const module = new ThesisChangeReviewModule(new FakeRepository());

    await expect(module.record(command({ beforeVersionId: "version-0" })))
      .rejects.toBeInstanceOf(ThesisChangeReviewError);
    await expect(module.record(command({ beforeVersionId: "version-0" })))
      .rejects.toMatchObject({ code: "VERSION_CONFLICT" });
  });

  it("refuses to invent a transition review when no daily brief has ever been published", async () => {
    const repository = new FakeRepository();
    repository.previous = null;

    await expect(new ThesisChangeReviewModule(repository).record(command()))
      .rejects.toMatchObject({ code: "NO_PREVIOUS_BRIEF" });
    expect(repository.stored).toHaveLength(0);
  });

  it("rejects unknown versions, self-transitions and malformed input before storage", async () => {
    const repository = new FakeRepository();
    const module = new ThesisChangeReviewModule(repository);

    await expect(module.record(command({ afterVersionId: "missing" })))
      .rejects.toMatchObject({ code: "NOT_FOUND" });
    await expect(module.record(command({ afterVersionId: "version-1" })))
      .rejects.toMatchObject({ code: "VALIDATION" });
    await expect(module.record(command({ decision: "maybe" as never })))
      .rejects.toMatchObject({ code: "VALIDATION" });
    await expect(module.record(command({ reason: "   " })))
      .rejects.toMatchObject({ code: "VALIDATION" });
    await expect(module.record(command({ actor: "" })))
      .rejects.toMatchObject({ code: "VALIDATION" });
    await expect(module.record(command({ occurredAt: "2026-09-11T00:00:00Z" })))
      .rejects.toMatchObject({ code: "VALIDATION" });
    expect(repository.stored).toHaveLength(0);
  });

  it("records a rejection so a refused transition stays auditable", async () => {
    const repository = new FakeRepository();
    const review = await new ThesisChangeReviewModule(repository).record(command({
      decision: "rejected",
      reason: "证据不足以支持方向变化",
    }));

    expect(review.decision).toBe("rejected");
    expect(repository.stored).toHaveLength(1);
  });
});
