import { INITIAL_THESIS_SEEDS } from "./initial-thesis-seeds";
import type { CoverageGap, ThesisSeed } from "./thesis-seeds";

/** Coverage gaps that make a thesis version ineligible for publication, in seed order. */
export function publicationBlockingGaps(seed: ThesisSeed): readonly CoverageGap[] {
  return seed.coverageGaps.filter((gap) => gap.blocks.includes("publication"));
}

/**
 * The single gap an operator acknowledges when a thesis is exempted from a daily brief.
 *
 * A gap that blocks publication without also blocking the transmission stage documents missing
 * direction evidence rather than an inability to evaluate the thesis at all, so it is the honest
 * anchor for "we know this thesis is unpublished and why". When a thesis has no such gap the first
 * publication-blocking gap is used so every exemptible thesis still has an explicit anchor.
 */
export function exemptionAnchorGap(seed: ThesisSeed): CoverageGap | null {
  const blocking = publicationBlockingGaps(seed);
  return blocking.find((gap) => !gap.blocks.includes("stage")) ?? blocking[0] ?? null;
}

export function thesisSeed(thesisId: string): ThesisSeed | null {
  return INITIAL_THESIS_SEEDS.find((seed) => seed.id === thesisId) ?? null;
}

export function coverageGapOf(thesisId: string, gapId: string): CoverageGap | null {
  return thesisSeed(thesisId)?.coverageGaps.find((gap) => gap.id === gapId) ?? null;
}

/**
 * Public copy for an acknowledged gap. An exemption records only the gap id, so the description is
 * resolved from the seed at read time; a gap that later disappears falls back to the thesis-level
 * coverage-gap copy instead of hiding the limitation or failing the whole page.
 */
export function coverageGapDescription(thesisId: string, gapId: string): string | null {
  const gap = coverageGapOf(thesisId, gapId);
  if (gap !== null) return gap.description;
  return thesisSeed(thesisId)?.templateCopy.coverageGap ?? null;
}
