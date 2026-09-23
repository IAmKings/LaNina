import { describe, it } from "vitest";

import type {
  CollectContext,
  CollectResult,
  SourceAdapter,
  SourceErrorCode,
} from "../../../../domain/ingestion";
import {
  SOURCE_ERROR_CODES,
  SourceCollectionError,
} from "../../../../domain/ingestion";
import { parseCanonicalUtc } from "../../../ingestion/time";
import { sha256Hex } from "../http";

interface ResultFixture {
  createContext(): CollectContext | Promise<CollectContext>;
  assertResult?(result: CollectResult): void | Promise<void>;
}

interface InvalidFixture {
  createContext(): CollectContext | Promise<CollectContext>;
  expectedError: {
    code: SourceErrorCode;
    retryable: boolean;
    httpStatus: number | null;
  };
}

export interface AdapterContractFixtures {
  name: string;
  adapter: SourceAdapter;
  normal: ResultFixture;
  unchanged: ResultFixture;
  invalid: InvalidFixture;
}

/**
 * Registers the fixed normal/unchanged/invalid contract shared by every source
 * adapter. Source-specific parsing assertions belong in the fixture callbacks.
 */
export function defineAdapterContract(fixtures: AdapterContractFixtures): void {
  describe(`${fixtures.name} adapter contract`, () => {
    it("returns an auditable changed or partial result for the normal fixture", async () => {
      const context = await fixtures.normal.createContext();
      const result = await fixtures.adapter.collect(context);

      contractInvariant(
        result.status === "changed" || result.status === "partial",
        "normal fixture must return changed or partial",
      );
      await validateAdapterContractResult(context, result);
      await fixtures.normal.assertResult?.(result);
    });

    it("returns no body or observations for the unchanged fixture", async () => {
      const context = await fixtures.unchanged.createContext();
      const result = await fixtures.adapter.collect(context);

      contractInvariant(result.status === "unchanged", "unchanged fixture must return unchanged");
      await validateAdapterContractResult(context, result);
      await fixtures.unchanged.assertResult?.(result);
    });

    it("throws a stable SourceCollectionError for the invalid fixture", async () => {
      const context = await fixtures.invalid.createContext();
      let thrown: unknown;

      try {
        await fixtures.adapter.collect(context);
      } catch (error: unknown) {
        thrown = error;
      }

      validateSourceCollectionError(thrown, fixtures.invalid.expectedError);
    });
  });
}

export async function validateAdapterContractResult(
  context: CollectContext,
  result: CollectResult,
): Promise<void> {
  contractInvariant(
    result.sourceId === context.sourceId,
    "result.sourceId must match context.sourceId",
  );
  contractInvariant(
    result.fetchedAt === context.fetchedAt,
    "result.fetchedAt must match context.fetchedAt",
  );
  validateCanonicalUtc(result.fetchedAt, "result.fetchedAt");
  if (result.sourcePublishedAt !== null) {
    validateCanonicalUtc(result.sourcePublishedAt, "result.sourcePublishedAt");
  }

  contractInvariant(Array.isArray(result.warnings), "result.warnings must be an array");
  for (const warning of result.warnings) {
    contractInvariant(warning.trim().length > 0, "result.warnings must not contain blanks");
  }

  if (result.status === "unchanged") {
    contractInvariant(result.rawBody === null, "unchanged result must not retain a response body");
    contractInvariant(
      result.observations.length === 0,
      "unchanged result must not emit observations",
    );
    return;
  }

  contractInvariant(
    result.rawBody instanceof Uint8Array,
    `${result.status} result must retain an audit body`,
  );
  const rawBody = result.rawBody;
  if (rawBody === null) throw new Error("adapter contract: missing audit body");
  contractInvariant(rawBody.byteLength > 0, "audit body must not be empty");
  contractInvariant(
    typeof result.contentHash === "string" && /^[a-f0-9]{64}$/.test(result.contentHash),
    "changed or partial result must include a lowercase SHA-256",
  );
  contractInvariant(result.contentHash === (await sha256Hex(rawBody)), "contentHash must match rawBody");
  contractInvariant(result.observations.length > 0, "changed or partial result must emit observations");

  for (const observation of result.observations) {
    contractInvariant(observation.indicatorId.trim().length > 0, "indicatorId must not be blank");
    validateCanonicalUtc(observation.observedAt, "observation.observedAt");
    if (observation.periodStart !== null) {
      validateCanonicalUtc(observation.periodStart, "observation.periodStart");
    }
    if (observation.publishedAt !== null) {
      validateCanonicalUtc(observation.publishedAt, "observation.publishedAt");
    }
    contractInvariant(
      observation.fetchedAt === context.fetchedAt,
      "observation.fetchedAt must match context.fetchedAt",
    );
    validateCanonicalUtc(observation.fetchedAt, "observation.fetchedAt");
    contractInvariant(
      typeof observation.value === "number"
        ? Number.isFinite(observation.value)
        : observation.value.trim().length > 0,
      "observation.value must be finite or non-blank",
    );
    contractInvariant(observation.unit.trim().length > 0, "observation.unit must not be blank");
    contractInvariant(
      ["verified", "provisional", "estimated", "manual", "invalid"].includes(
        observation.quality,
      ),
      "observation.quality is unsupported",
    );
    let citation: URL;
    try {
      citation = new URL(observation.citationUrl);
    } catch {
      throw new Error("adapter contract: observation.citationUrl must be an absolute URL");
    }
    contractInvariant(citation.protocol === "https:", "observation.citationUrl must use HTTPS");
    contractInvariant(
      observation.metadata !== null && !Array.isArray(observation.metadata),
      "observation.metadata must be an object",
    );
  }
}

export function validateSourceCollectionError(
  thrown: unknown,
  expected: InvalidFixture["expectedError"],
): asserts thrown is SourceCollectionError {
  contractInvariant(thrown instanceof SourceCollectionError, "invalid fixture must reject");
  contractInvariant(SOURCE_ERROR_CODES.includes(thrown.code), "error code must be stable");
  contractInvariant(thrown.code === expected.code, "error code must match the fixture contract");
  contractInvariant(
    thrown.retryable === expected.retryable,
    "error retryability must match the fixture contract",
  );
  contractInvariant(
    thrown.httpStatus === expected.httpStatus,
    "error HTTP status must match the fixture contract",
  );
  contractInvariant(thrown.message.trim().length > 0, "error message must not be blank");
}

function validateCanonicalUtc(value: string, field: string): void {
  try {
    parseCanonicalUtc(value, field);
  } catch {
    throw new Error(`adapter contract: ${field} must be canonical UTC`);
  }
}

function contractInvariant(condition: boolean, message: string): asserts condition {
  if (!condition) throw new Error(`adapter contract: ${message}`);
}
