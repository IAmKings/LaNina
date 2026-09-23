import type { PublicChangeModel } from "./page-models";

/**
 * Public-only facts used to generate the non-JSON Atom representation.
 * This deliberately contains neither version identities nor any frozen or
 * raw-source payload that is not already public through the changes feed.
 */
export interface AtomFeedModel {
  readonly changes: readonly PublicChangeModel[];
  readonly dailyBriefs: readonly AtomDailyBriefModel[];
}

export interface AtomDailyBriefModel {
  readonly briefDate: string;
  readonly headline: string;
  readonly summary: string;
  readonly dataCutoff: string;
  readonly publishedAt: string;
}
