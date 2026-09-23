import { reportStorageFailure } from "./storage-logging";
import { REQUIRED_DAILY_THESIS_IDS } from "../../../domain/daily-brief";
import {
  DailyPublicationTargetError,
  type CutoffThesisVersion,
  type DailyPublicationTargetRepository,
} from "../../modules/daily-publication";

/**
 * Resolves the six target versions for a manual daily-brief publication.
 *
 * Unlike the scheduled candidate lookup, this is not restricted to `system:daily-evaluation`
 * creators: an operator may publish a human-reviewed thesis version and still freeze a daily brief
 * for the same cutoff. Eligibility rules stay identical to the publication gate.
 */
export class D1DailyPublicationTargetRepository implements DailyPublicationTargetRepository {
  constructor(private readonly database: D1Database) {}

  async findCutoffVersions(cutoff: string): Promise<readonly CutoffThesisVersion[]> {
    const placeholders = REQUIRED_DAILY_THESIS_IDS.map(() => "?").join(", ");
    try {
      const result = await this.database.prepare(
        `SELECT version.thesis_id, version.id AS thesis_version_id, version.version, version.status,
                (SELECT MAX(latest.version) FROM thesis_versions latest
                  WHERE latest.thesis_id = version.thesis_id) AS latest_version
           FROM thesis_versions version
          WHERE version.thesis_id IN (${placeholders})
            AND version.based_on_cutoff = ?
          ORDER BY version.thesis_id, version.version`,
      ).bind(...REQUIRED_DAILY_THESIS_IDS, cutoff).all<Record<string, unknown>>();
      if (result.success !== true || !Array.isArray(result.results)) throw databaseError();
      return result.results.map(decodeVersion);
    } catch (error) {
      if (error instanceof DailyPublicationTargetError) throw error;
      reportStorageFailure("daily-publication.findCutoffVersions", error);
      throw databaseError();
    }
  }
}

function decodeVersion(row: Record<string, unknown>): CutoffThesisVersion {
  const thesisId = row.thesis_id;
  const thesisVersionId = row.thesis_version_id;
  const version = row.version;
  const latest = row.latest_version;
  const status = row.status;
  if (
    typeof thesisId !== "string"
    || typeof thesisVersionId !== "string"
    || !Number.isInteger(version)
    || (version as number) < 1
    || !Number.isInteger(latest)
    || (latest as number) < 1
    || (status !== "draft" && status !== "published" && status !== "withdrawn")
  ) {
    throw databaseError();
  }
  return {
    thesisId,
    thesisVersionId,
    version: version as number,
    status,
    isLatest: version === latest,
  };
}

function databaseError(): DailyPublicationTargetError {
  return new DailyPublicationTargetError("DATABASE", "每日判定目标暂不可用，请稍后重试");
}
