import { describe, expect, it, vi } from "vitest";

import { REQUIRED_DAILY_THESIS_IDS } from "../../domain/daily-brief";
import type { EvaluationEvidenceInput } from "../../domain/evaluation";
import {
  approvedDraftSeed,
  makeDraftCandidate,
} from "../../domain/thesis-draft.test-support";
import type {
  PersistedThesisDraft,
  ThesisDraftStorageRecord,
} from "../../domain/thesis-draft";
import type { ThesisDraftRepository } from "./thesis-drafts";
import { ThesisDraftModule } from "./thesis-drafts";
import {
  automaticPublicationDisabledResult,
  DailyEvaluationJob,
  DailyPublicationJob,
  precedingEvaluationCutoff,
  type DailyEvaluationRepository,
  type DailyPublicationCandidateRepository,
} from "./daily-schedule";

const EVALUATION_CUTOFF = "2026-09-09T22:30:00.000Z";
const PUBLICATION_TIME = "2026-09-09T23:00:00.000Z";

describe("DailyEvaluationJob", () => {
  it("addresses the six production seeds in stable order without reading D1 or writing drafts", async () => {
    // approved seeds (2026-09-21 D-组) 允许 D1 访问，这里用空列表模拟尚未发布的月度输入
    const repository = { loadEvaluationInputs: vi.fn(async () => [] as never[]) };
    const drafts = { create: vi.fn(() => {
      throw new Error("approved seeds 评估结果 blocked，尚不写草稿");
    }) };

    const result = await new DailyEvaluationJob(repository, drafts).run({
      scheduledAt: EVALUATION_CUTOFF,
    });

    expect(result).toMatchObject({
      briefDate: "2026-09-10",
      cutoff: EVALUATION_CUTOFF,
      outcome: "blocked",
      draftsReady: 0,
      blockedCount: 6,
    });
    expect(result.theses.map(({ thesisId }) => thesisId)).toEqual(REQUIRED_DAILY_THESIS_IDS);
    expect(result.theses.every((item) =>
      item.status === "blocked" && item.reasonCode !== undefined
    )).toBe(true);
    expect(repository.loadEvaluationInputs).toHaveBeenCalled();
    /* approved 评估仍 blocked（D1 无 input），drafts.create 不会被调用 */
  });

  it("uses scheduledAt as the strict cutoff and persists an approved draft idempotently", async () => {
    const seed = approvedDraftSeed();
    const candidate = makeDraftCandidate({ seed, cutoff: EVALUATION_CUTOFF });
    const weatherInput = candidate.selection.inputs.find(({ indicatorId }) =>
      indicatorId === "enso_roni_ersstv6"
    )!;
    const marketInput = candidate.selection.inputs.find(({ indicatorId }) =>
      indicatorId === "eia_europe_brent_spot_usd_per_bbl_daily"
    )!;
    const before: EvaluationEvidenceInput = {
      ...weatherInput,
      observedAt: "2026-09-09T22:00:00.000Z",
      publishedAt: "2026-09-09T22:10:00.000Z",
      fetchedAt: EVALUATION_CUTOFF,
    };
    const after: EvaluationEvidenceInput = {
      ...marketInput,
      evidenceId: "after-cutoff-evidence",
      observationId: "after-cutoff-observation",
      fetchedAt: "2026-09-09T22:30:00.001Z",
    };
    const repository: DailyEvaluationRepository = {
      loadEvaluationInputs: vi.fn<DailyEvaluationRepository["loadEvaluationInputs"]>(async (_seeds, cutoff) => [{
        thesisId: seed.id,
        previousStage: "watch" as const,
        hasPreviousVersion: false,
        evidence: [after, { ...before, fetchedAt: cutoff }],
      }]),
    };
    const storage = new IdempotentDraftRepository();
    const job = new DailyEvaluationJob(
      repository,
      new ThesisDraftModule(storage),
      [seed],
    );

    const first = await job.run({ scheduledAt: EVALUATION_CUTOFF });
    const second = await job.run({ scheduledAt: EVALUATION_CUTOFF });

    expect(repository.loadEvaluationInputs).toHaveBeenCalledWith([seed], EVALUATION_CUTOFF);
    expect(first).toMatchObject({ outcome: "completed", draftsReady: 1, blockedCount: 0 });
    expect(second).toEqual(first);
    expect(storage.records).toHaveLength(1);
    expect(storage.records[0]!.basedOnCutoff).toBe(EVALUATION_CUTOFF);
    expect(storage.records[0]!.calculation.selection.selectedEvidence.map(({ evidenceId }) => evidenceId))
      .toEqual([before.evidenceId]);
    expect(storage.records[0]!.calculation.selection.rejectedEvidence).toContainEqual(
      expect.objectContaining({ evidenceId: "after-cutoff-evidence", code: "AFTER_CUTOFF" }),
    );
  });

  it("blocks an approved seed when the repository cannot provide its input", async () => {
    const seed = approvedDraftSeed();
    const result = await new DailyEvaluationJob(
      { loadEvaluationInputs: async () => [] },
      { create: vi.fn() },
      [seed],
    ).run({ scheduledAt: EVALUATION_CUTOFF });

    expect(result.theses).toEqual([{
      thesisId: seed.id,
      status: "blocked",
      reasonCode: "MISSING_EVALUATION_INPUT",
    }]);
  });

  it("rejects non-canonical scheduled timestamps before repository access", async () => {
    const repository = { loadEvaluationInputs: vi.fn() };
    await expect(new DailyEvaluationJob(repository, { create: vi.fn() }).run({
      scheduledAt: "2026-09-10 06:30",
    })).rejects.toMatchObject({ code: "VALIDATION" });
    expect(repository.loadEvaluationInputs).not.toHaveBeenCalled();
  });

  it("rejects a canonical instant that is not the 22:30 UTC evaluation slot", async () => {
    const repository = { loadEvaluationInputs: vi.fn() };
    await expect(new DailyEvaluationJob(repository, { create: vi.fn() }).run({
      scheduledAt: "2026-09-09T22:31:00.000Z",
    })).rejects.toMatchObject({ code: "VALIDATION" });
    expect(repository.loadEvaluationInputs).not.toHaveBeenCalled();
  });
});

describe("DailyPublicationJob", () => {
  it("targets the same Shanghai date and exact preceding evaluation cutoff", async () => {
    const repository: DailyPublicationCandidateRepository = {
      findEvaluationCandidates: vi.fn(async () => []),
    };

    const result = await new DailyPublicationJob(repository).run({ scheduledAt: PUBLICATION_TIME });

    expect(repository.findEvaluationCandidates).toHaveBeenCalledWith(EVALUATION_CUTOFF);
    expect(result).toMatchObject({
      briefDate: "2026-09-10",
      scheduledAt: PUBLICATION_TIME,
      evaluationCutoff: EVALUATION_CUTOFF,
      outcome: "delayed",
      candidateCount: 0,
    });
    expect(result.delayCodes).toEqual([
      ...REQUIRED_DAILY_THESIS_IDS.map((id) => `EVALUATION_OUTPUT_MISSING:${id}`),
    ]);
  });

  it("remains non-publishing and explains draft, missing and duplicate candidates", async () => {
    const repository: DailyPublicationCandidateRepository = {
      findEvaluationCandidates: async () => [
        { thesisId: "ENSO-CORE-01", thesisVersionId: "enso-1", status: "draft" },
        { thesisId: "RUBBER-TH-01", thesisVersionId: "rubber-1", status: "published" },
        { thesisId: "RUBBER-TH-01", thesisVersionId: "rubber-2", status: "draft" },
      ],
    };

    const result = await new DailyPublicationJob(repository).run({ scheduledAt: PUBLICATION_TIME });

    expect(result.outcome).toBe("delayed");
    expect(result.delayCodes).toEqual([
      "THESIS_VERSION_NOT_PUBLISHED:ENSO-CORE-01",
      "EVALUATION_OUTPUT_DUPLICATE:RUBBER-TH-01",
      "EVALUATION_OUTPUT_MISSING:PALM-SEA-01",
      "EVALUATION_OUTPUT_MISSING:MAIZE-SA-01",
      "EVALUATION_OUTPUT_MISSING:SHIP-USEC-01",
      "EVALUATION_OUTPUT_MISSING:SHIP-EU-01",
    ]);
  });

  it("fails closed on the unresolved atomic lifecycle after all candidate checks pass", async () => {
    const repository: DailyPublicationCandidateRepository = {
      findEvaluationCandidates: vi.fn(async () => REQUIRED_DAILY_THESIS_IDS.map((thesisId) => ({
        thesisId,
        thesisVersionId: `${thesisId}-version`,
        status: "published" as const,
      }))),
    };

    const result = await new DailyPublicationJob(repository).run({ scheduledAt: PUBLICATION_TIME });

    expect(result.candidateCount).toBe(6);
    expect(result.delayCodes).toEqual(["AUTOMATIC_PUBLICATION_LIFECYCLE_UNAVAILABLE"]);
  });

  it("builds the manual-publication default result without a candidate repository", () => {
    expect(automaticPublicationDisabledResult({ scheduledAt: PUBLICATION_TIME })).toEqual({
      briefDate: "2026-09-10",
      scheduledAt: PUBLICATION_TIME,
      evaluationCutoff: EVALUATION_CUTOFF,
      outcome: "delayed",
      candidateCount: null,
      delayCodes: ["AUTOMATIC_PUBLICATION_DISABLED"],
    });
  });

  it("handles the previous UTC day while retaining the next Shanghai brief date", () => {
    expect(precedingEvaluationCutoff("2025-12-31T23:00:00.000Z"))
      .toBe("2025-12-31T22:30:00.000Z");
  });

  it("derives the next Shanghai year without leaking a cross-date candidate", async () => {
    const repository: DailyPublicationCandidateRepository = {
      findEvaluationCandidates: vi.fn(async () => []),
    };

    const result = await new DailyPublicationJob(repository).run({
      scheduledAt: "2025-12-31T23:00:00.000Z",
    });

    expect(result.briefDate).toBe("2026-01-01");
    expect(result.evaluationCutoff).toBe("2025-12-31T22:30:00.000Z");
  });

  it("rejects a canonical instant that is not the 23:00 UTC publication slot", async () => {
    const repository: DailyPublicationCandidateRepository = {
      findEvaluationCandidates: vi.fn(async () => []),
    };

    await expect(new DailyPublicationJob(repository).run({
      scheduledAt: "2026-09-09T23:01:00.000Z",
    })).rejects.toMatchObject({ code: "VALIDATION" });
    expect(repository.findEvaluationCandidates).not.toHaveBeenCalled();
  });
});

class IdempotentDraftRepository implements ThesisDraftRepository {
  readonly records: ThesisDraftStorageRecord[] = [];
  private readonly drafts = new Map<string, PersistedThesisDraft>();

  async createAutomatic(record: ThesisDraftStorageRecord): Promise<PersistedThesisDraft> {
    const existing = this.drafts.get(record.draftKey);
    if (existing !== undefined) return existing;
    const draft = { ...record, id: "scheduled-draft-1", version: 1 };
    this.records.push(record);
    this.drafts.set(record.draftKey, draft);
    return draft;
  }

  async editExpected(): Promise<PersistedThesisDraft> {
    throw new Error("not used");
  }

  async editAdministrative(): Promise<PersistedThesisDraft> {
    throw new Error("not used");
  }
}
