import type { ThesisDirection, ThesisStage } from "./contracts";

export const THESIS_PUBLICATION_ACTIONS = ["publish", "withdraw"] as const;

export type ThesisPublicationAction = (typeof THESIS_PUBLICATION_ACTIONS)[number];

export interface ThesisPublicationCommand {
  readonly versionId: string;
  readonly thesisId: string;
  readonly expectedVersion: number;
  readonly actor: string;
  readonly reason: string;
  readonly occurredAt: string;
}

export interface ThesisPublicationMutation extends ThesisPublicationCommand {
  readonly action: ThesisPublicationAction;
  readonly transitionId: string;
  readonly auditId: string;
  readonly cacheToken: string;
}

export interface PublishedThesisVersionReference {
  readonly id: string;
  readonly thesisId: string;
  readonly version: number;
  readonly status: "published";
  readonly direction: ThesisDirection;
  readonly stage: ThesisStage;
  readonly confidence: number;
  readonly summary: string;
  readonly invalidation: string;
  readonly basedOnCutoff: string;
  readonly publishedBy: string;
  readonly publishedAt: string;
}

export interface ThesisPublicationTransition {
  readonly action: ThesisPublicationAction;
  readonly thesisId: string;
  readonly targetVersionId: string;
  readonly expectedVersion: number;
  readonly previousPublishedVersionId: string | null;
  readonly currentPublished: PublishedThesisVersionReference | null;
  readonly cacheToken: string;
  readonly transitionId: string;
  readonly audit: {
    readonly id: string;
    readonly actor: string;
    readonly reason: string;
    readonly createdAt: string;
  };
}
