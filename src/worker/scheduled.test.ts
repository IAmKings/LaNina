import { describe, expect, it } from "vitest";

import type { DailyEvaluationRunResult } from "./modules/daily-schedule";
import { handleScheduled } from "./scheduled";
import { EVALUATION_CRON, type Env } from "./index";
import { DerivedIndicatorError } from "./modules/derived-indicators";

const SCHEDULED_AT = "2026-09-26T22:30:00.000Z";

function evaluationController(): ScheduledController {
  return {
    cron: EVALUATION_CRON,
    scheduledTime: Date.parse(SCHEDULED_AT),
  } as unknown as ScheduledController;
}

function env(): Env {
  return { ENABLE_CRON: "true", APP_ENV: "test" } as unknown as Env;
}

function evaluationResult(): DailyEvaluationRunResult {
  return {
    briefDate: "2026-09-27",
    cutoff: SCHEDULED_AT,
    outcome: "completed",
    draftsReady: 0,
    blockedCount: 0,
    theses: [],
  };
}

describe("evaluation cron derived recalculation ordering", () => {
  it("runs the derived recalculation before the per-thesis evaluation", async () => {
    const calls: string[] = [];
    const result = await handleScheduled(evaluationController(), env(), {
      refreshClimatology: async () => {
        calls.push("climatology");
        return { scheduledAt: SCHEDULED_AT, outcomes: [] };
      },
      recalculateDerived: async () => {
        calls.push("derived");
        return { scheduledAt: SCHEDULED_AT, outcomes: [] };
      },
      evaluate: async () => {
        calls.push("evaluate");
        return evaluationResult();
      },
    });

    expect(calls).toEqual(["climatology", "derived", "evaluate"]);
    expect(result).toMatchObject({
      job: "evaluation",
      outcome: "completed",
      briefDate: "2026-09-27",
      sourcesDispatched: 0,
    });
  });

  it("fails the cron closed when the derived recalculation fails", async () => {
    await expect(
      handleScheduled(evaluationController(), env(), {
        refreshClimatology: async () => ({ scheduledAt: SCHEDULED_AT, outcomes: [] }),
        recalculateDerived: async () => {
          throw new DerivedIndicatorError("DATABASE", "D1 无法持久化派生观测");
        },
        evaluate: async () => {
          throw new Error("evaluation must not run after a failed recalculation");
        },
      }),
    ).rejects.toMatchObject({ code: "DATABASE", name: "DerivedIndicatorError" });
  });
});
