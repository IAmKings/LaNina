import { describe, expect, it } from "vitest";
import { INITIAL_THESIS_SEEDS } from "../../domain/initial-thesis-seeds";
import type {
  PublishedThesisVersionReference,
  ThesisPublicationMutation,
  ThesisPublicationTransition,
} from "../../domain/thesis-publication";
import {
  approvedDraftSeed,
  approvedPublicationSeed,
} from "../../domain/thesis-draft.test-support";
import {
  ThesisPublicationModule,
  type ThesisPublicationRepository,
} from "./thesis-publications";

const COMMAND = {
  versionId: "version-1",
  thesisId: "TEST-THESIS-01",
  expectedVersion: 1,
  actor: "publisher@example.com",
  reason: "研究负责人审核通过",
  occurredAt: "2026-09-09T01:00:00.000Z",
} as const;

describe("ThesisPublicationModule", () => {
  it("requires an approved production-publication seed before calling storage", async () => {
    const repository = new StubPublicationRepository();
    const module = new ThesisPublicationModule(
      repository,
      () => approvedDraftSeed(),
      idFactory(),
    );

    await expect(module.publish(COMMAND)).rejects.toMatchObject({
      code: "PUBLICATION_DISABLED",
      details: null,
    });
    expect(repository.mutations).toEqual([]);
  });

  it("publishes the five gap-carrying seeds and keeps only SHIP-EU-01 disabled", async () => {
    // D 组口径（2026-09-25）：覆盖缺口不再否决发布，只有人工未签字的 SHIP-EU-01 保持关闭。
    for (const seed of INITIAL_THESIS_SEEDS) {
      const repository = new StubPublicationRepository();
      const module = new ThesisPublicationModule(repository, () => seed, idFactory());
      if (seed.id === "SHIP-EU-01") {
        await expect(module.publish({ ...COMMAND, thesisId: seed.id }))
          .rejects.toMatchObject({ code: "PUBLICATION_DISABLED" });
        expect(repository.mutations).toEqual([]);
        continue;
      }
      await expect(module.publish({ ...COMMAND, thesisId: seed.id }))
        .resolves.toMatchObject({ action: "publish", thesisId: seed.id });
      expect(repository.mutations).toHaveLength(1);
    }
  });

  it("validates named actor, reason, expected version and canonical UTC", async () => {
    const repository = new StubPublicationRepository();
    const module = new ThesisPublicationModule(repository, () => approvedPublicationSeed(), idFactory());

    await expect(module.publish({ ...COMMAND, actor: " " }))
      .rejects.toMatchObject({ code: "VALIDATION" });
    await expect(module.withdraw({ ...COMMAND, reason: "" }))
      .rejects.toMatchObject({ code: "VALIDATION" });
    await expect(module.publish({ ...COMMAND, expectedVersion: 0 }))
      .rejects.toMatchObject({ code: "VALIDATION" });
    await expect(module.withdraw({ ...COMMAND, occurredAt: "2026-09-09 01:00:00" }))
      .rejects.toMatchObject({ code: "VALIDATION" });
    await expect(module.publish({ ...COMMAND, unexpected: true } as typeof COMMAND))
      .rejects.toMatchObject({ code: "VALIDATION" });
    expect(repository.mutations).toEqual([]);
  });

  it("creates internal transition, audit and cache identities for approved publish", async () => {
    const repository = new StubPublicationRepository();
    const module = new ThesisPublicationModule(repository, () => approvedPublicationSeed(), idFactory());

    await module.publish(COMMAND);

    expect(repository.mutations).toEqual([{
      ...COMMAND,
      action: "publish",
      transitionId: "generated-1",
      auditId: "generated-2",
      cacheToken: "generated-3",
    }]);
  });

  it("allows emergency withdrawal without requiring a currently publishable seed", async () => {
    const repository = new StubPublicationRepository();
    const module = new ThesisPublicationModule(
      repository,
      () => INITIAL_THESIS_SEEDS[0],
      idFactory(),
    );

    await module.withdraw(COMMAND);

    expect(repository.mutations[0]).toMatchObject({ action: "withdraw", ...COMMAND });
  });
});

function idFactory(): () => string {
  let id = 0;
  return () => `generated-${++id}`;
}

class StubPublicationRepository implements ThesisPublicationRepository {
  readonly mutations: ThesisPublicationMutation[] = [];

  publish(mutation: ThesisPublicationMutation): Promise<ThesisPublicationTransition> {
    this.mutations.push(mutation);
    return Promise.resolve(transition(mutation));
  }

  withdrawAndRestore(mutation: ThesisPublicationMutation): Promise<ThesisPublicationTransition> {
    this.mutations.push(mutation);
    return Promise.resolve(transition(mutation));
  }

  findCurrentPublished(): Promise<PublishedThesisVersionReference | null> {
    return Promise.resolve(null);
  }
}

function transition(mutation: ThesisPublicationMutation): ThesisPublicationTransition {
  return {
    action: mutation.action,
    thesisId: mutation.thesisId,
    targetVersionId: "version-1",
    expectedVersion: mutation.expectedVersion,
    previousPublishedVersionId: null,
    currentPublished: null,
    cacheToken: mutation.cacheToken,
    transitionId: mutation.transitionId,
    audit: {
      id: mutation.auditId,
      actor: mutation.actor,
      reason: mutation.reason,
      createdAt: mutation.occurredAt,
    },
  };
}
