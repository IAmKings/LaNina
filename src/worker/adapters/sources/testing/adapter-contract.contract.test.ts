import { describe, expect, it } from "vitest";

import type { CollectContext, CollectResult } from "../../../../domain/ingestion";
import { SourceCollectionError } from "../../../../domain/ingestion";
import { sha256Hex } from "../http";
import {
  validateAdapterContractResult,
  validateSourceCollectionError,
} from "./adapter-contract";

const context: CollectContext = {
  sourceId: "fixture_source",
  sourceUrl: "https://example.com/source",
  scheduledAt: "2026-09-08T00:00:00.000Z",
  fetchedAt: "2026-09-08T00:00:01.000Z",
  previousEtag: null,
  previousLastModified: null,
  previousContentHash: null,
  fetch: async () => new Response(null, { status: 304 }),
};

async function changedResult(): Promise<CollectResult> {
  const rawBody = new TextEncoder().encode("fixed contract fixture");
  return {
    sourceId: context.sourceId,
    fetchedAt: context.fetchedAt,
    sourcePublishedAt: null,
    etag: '"fixture"',
    lastModified: null,
    contentType: "text/plain",
    contentHash: await sha256Hex(rawBody),
    rawBody,
    observations: [
      {
        indicatorId: "fixture_indicator",
        observedAt: "2026-09-07T00:00:00.000Z",
        periodStart: null,
        value: 1,
        unit: "index",
        publishedAt: null,
        fetchedAt: context.fetchedAt,
        quality: "verified",
        citationUrl: context.sourceUrl,
        metadata: {},
      },
    ],
    warnings: [],
    status: "changed",
  };
}

describe("adapter contract harness rejection coverage", () => {
  it("rejects context identity drift", async () => {
    const result = await changedResult();
    result.sourceId = "another_source";

    await expect(validateAdapterContractResult(context, result)).rejects.toThrow(
      "result.sourceId must match context.sourceId",
    );
  });

  it("rejects an audit body whose SHA-256 does not match", async () => {
    const result = await changedResult();
    result.contentHash = "0".repeat(64);

    await expect(validateAdapterContractResult(context, result)).rejects.toThrow();
  });

  it("rejects an invalid observation timestamp", async () => {
    const result = await changedResult();
    result.observations[0].observedAt = "2026-09-07";

    await expect(validateAdapterContractResult(context, result)).rejects.toThrow(
      "observation.observedAt must be canonical UTC",
    );
  });

  it("rejects a missing observation unit", async () => {
    const result = await changedResult();
    result.observations[0].unit = "";

    await expect(validateAdapterContractResult(context, result)).rejects.toThrow(
      "observation.unit must not be blank",
    );
  });

  it("rejects observations attached to an unchanged result", async () => {
    const result = await changedResult();
    result.status = "unchanged";
    result.rawBody = null;

    await expect(validateAdapterContractResult(context, result)).rejects.toThrow(
      "unchanged result must not emit observations",
    );
  });

  it("rejects an ordinary Error from an invalid fixture", () => {
    expect(() =>
      validateSourceCollectionError(new Error("unstable"), {
        code: "SCHEMA_DRIFT",
        retryable: false,
        httpStatus: null,
      }),
    ).toThrow("invalid fixture must reject");
  });

  it("accepts the declared stable error category", () => {
    expect(() =>
      validateSourceCollectionError(
        new SourceCollectionError("SCHEMA_DRIFT", "fixed parser failure"),
        {
          code: "SCHEMA_DRIFT",
          retryable: false,
          httpStatus: null,
        },
      ),
    ).not.toThrow();
  });
});
