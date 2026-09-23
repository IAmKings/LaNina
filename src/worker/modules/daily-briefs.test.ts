import { describe, expect, it } from "vitest";
import { REQUIRED_DAILY_THESIS_IDS } from "../../domain/daily-brief";
import type { DailyBriefRepository } from "./daily-briefs";
import { DailyBriefModule } from "./daily-briefs";

describe("DailyBriefModule", () => {
  it("derives the Asia/Shanghai brief date and generates internal identities", async () => {
    const repository = new CapturingRepository();
    let id = 0;
    const module = new DailyBriefModule(repository, () => `daily-id-${++id}`);

    await module.freezeAndPublish(command());

    expect(repository.mutation).toMatchObject({
      briefDate: "2026-09-10",
      attemptId: "daily-id-1",
      auditId: "daily-id-2",
    });
  });

  it("rejects duplicate, missing and cross-contract targets before D1", async () => {
    const repository = new CapturingRepository();
    const module = new DailyBriefModule(repository);
    const duplicate = command();
    duplicate.targets[1] = { ...duplicate.targets[0]! };
    await expect(module.freezeAndPublish(duplicate)).rejects.toMatchObject({ code: "VALIDATION" });
    expect(repository.mutation).toBeNull();
  });

  it("rejects host-local or invalid time and unknown command fields", async () => {
    const module = new DailyBriefModule(new CapturingRepository());
    await expect(module.freezeAndPublish({ ...command(), cutoff: "2026-09-10 06:30" }))
      .rejects.toMatchObject({ code: "VALIDATION" });
    await expect(module.freezeAndPublish({ ...command(), gatePassed: true } as never))
      .rejects.toMatchObject({ code: "VALIDATION" });
  });
});

class CapturingRepository implements DailyBriefRepository {
  mutation: Parameters<DailyBriefRepository["freezeAndPublish"]>[0] | null = null;

  async freezeAndPublish(mutation: Parameters<DailyBriefRepository["freezeAndPublish"]>[0]) {
    this.mutation = mutation;
    return result(mutation.briefDate, mutation.attemptId);
  }

  async findPublished() {
    return null;
  }

  async findCurrentFreezeKey() {
    return null;
  }
}

function command() {
  return {
    cutoff: "2026-09-09T22:30:00.000Z",
    targets: REQUIRED_DAILY_THESIS_IDS.map((thesisId, index) => ({
      thesisId,
      thesisVersionId: `version-${index + 1}`,
    })),
    headline: "今日影响判定",
    summary: "六论点冻结完成",
    topChanges: ["无重大变化"],
    actor: "publisher@example.com",
    reason: "每日判定门禁通过",
    occurredAt: "2026-09-09T23:00:00.000Z",
    expectedFreezeKey: null,
  };
}

function result(briefDate: string, attemptId: string) {
  return {
    briefDate,
    status: "delayed" as const,
    freezeKey: "freeze-key",
    cutoff: "2026-09-09T22:30:00.000Z",
    headline: "今日影响判定",
    summary: "六论点冻结完成",
    topChanges: [],
    gates: [],
    sourceHealth: [],
    versions: [],
    publishedAt: null,
    publishedBy: null,
    attemptId,
  };
}
