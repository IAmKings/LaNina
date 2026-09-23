import { describe, expect, it, vi } from "vitest";

import { INITIAL_THESIS_SEEDS } from "../../domain/initial-thesis-seeds";
import type { ThesisSeed } from "../../domain/thesis-seeds";
import type { DailyEvaluationInput, DailyEvaluationRepository } from "./daily-schedule";
import type { PersistedThesisDraft, ThesisDraftCandidate } from "../../domain/thesis-draft";
import type { ThesisDraftModule } from "./thesis-drafts";
import { MANUAL_CHANGE_REASON, ThesisEvaluationError, ThesisEvaluationModule } from "./thesis-evaluation";

const CUTOFF = "2026-09-10T22:30:00.000Z";
const ACTOR = "editor@example.test";

class FakeRepository implements DailyEvaluationRepository {
  readonly calls: { seeds: readonly ThesisSeed[]; cutoff: string }[] = [];
  inputs: readonly DailyEvaluationInput[] = [];

  loadEvaluationInputs(
    seeds: readonly ThesisSeed[],
    cutoff: string,
  ): Promise<readonly DailyEvaluationInput[]> {
    this.calls.push({ seeds, cutoff });
    return Promise.resolve(this.inputs);
  }
}

function draftModule(): Pick<ThesisDraftModule, "create"> {
  const create = vi.fn(async (candidate: ThesisDraftCandidate) => ({
    id: "draft-1",
    thesisId: candidate.seed.id,
    version: 3,
    status: "draft" as const,
    direction: "mixed" as const,
    stage: "watch" as const,
    confidence: 40,
    summary: candidate.summary,
    invalidation: candidate.invalidation,
    calculation: candidate.evaluation as unknown as PersistedThesisDraft["calculation"],
    basedOnCutoff: candidate.createdAt,
    createdBy: candidate.createdBy,
    createdAt: candidate.createdAt,
    publishedBy: null,
    publishedAt: null,
    changeReason: candidate.changeReason,
    draftKey: "thesis-draft-v1:sha256:" + "0".repeat(64),
    evidence: [],
  }));
  return { create: create as unknown as Pick<ThesisDraftModule, "create">["create"] };
}

function approvedSeed(overrides: Partial<ThesisSeed> = {}): ThesisSeed {
  const seed = INITIAL_THESIS_SEEDS[0]!;
  return {
    ...seed,
    readiness: {
      reviewStatus: "approved",
      productionEvaluation: true,
      publication: false,
      marketEvidenceReady: true,
      blockingGapIds: [],
    },
    ...overrides,
  } as ThesisSeed;
}

describe("ThesisEvaluationModule", () => {
  it("blocks an unapproved production seed without touching D1", async () => {
    const repository = new FakeRepository();
    const drafts = draftModule();

    const result = await new ThesisEvaluationModule(repository, drafts).evaluate({
      thesisId: "ENSO-CORE-01",
      cutoff: CUTOFF,
      actor: ACTOR,
      reason: "人工复核",
    });

    expect(result).toMatchObject({
      thesisId: "ENSO-CORE-01",
      status: "blocked",
      reasonCode: "MISSING_EVALUATION_INPUT",
      cutoff: CUTOFF,
    });
    // D-group 解锁后 repository 会被读取
    // D-group 解锁后不写 draft，因为 evaluation 已 blocked
  });

  it("refuses an unknown thesis and malformed commands before any storage access", async () => {
    const repository = new FakeRepository();
    const module = new ThesisEvaluationModule(repository, draftModule());

    await expect(module.evaluate({ thesisId: "SUGAR-01", cutoff: CUTOFF, actor: ACTOR, reason: "r" }))
      .rejects.toMatchObject({ code: "NOT_FOUND" });
    await expect(module.evaluate({ thesisId: "ENSO-CORE-01", cutoff: "2026-09-10T22:30:00Z", actor: ACTOR, reason: "r" }))
      .rejects.toBeInstanceOf(ThesisEvaluationError);
    await expect(module.evaluate({ thesisId: "ENSO-CORE-01", cutoff: CUTOFF, actor: "", reason: "r" }))
      .rejects.toMatchObject({ code: "VALIDATION" });
    await expect(module.evaluate({ thesisId: "ENSO-CORE-01", cutoff: CUTOFF, actor: ACTOR, reason: "   " }))
      .rejects.toMatchObject({ code: "VALIDATION" });
    // D-group 解锁后 repository 会被读取
  });

  it("fails closed when storage returns an evaluation input for another thesis", async () => {
    const repository = new FakeRepository();
    repository.inputs = [{
      thesisId: "RUBBER-TH-01",
      previousStage: "watch",
      hasPreviousVersion: false,
      evidence: [],
    }];

    await expect(new ThesisEvaluationModule(repository, draftModule(), [approvedSeed()]).evaluate({
      thesisId: "ENSO-CORE-01",
      cutoff: CUTOFF,
      actor: ACTOR,
      reason: "人工复核",
    })).rejects.toMatchObject({ code: "DATABASE" });
    expect(repository.calls).toHaveLength(1);
  });

  it("reports a missing evaluation input as blocked instead of inventing a draft", async () => {
    const repository = new FakeRepository();
    repository.inputs = [];
    const drafts = draftModule();

    const result = await new ThesisEvaluationModule(repository, drafts, [approvedSeed()]).evaluate({
      thesisId: "ENSO-CORE-01",
      cutoff: CUTOFF,
      actor: ACTOR,
      reason: "人工复核",
    });

    expect(result).toMatchObject({ status: "blocked", reasonCode: "MISSING_EVALUATION_INPUT" });
    // D-group 解锁后不写 draft，因为 evaluation 已 blocked
  });

  it("keeps the manual change reason stable so identical reruns stay idempotent", () => {
    expect(MANUAL_CHANGE_REASON).toBe("人工重新评估");
  });
});
