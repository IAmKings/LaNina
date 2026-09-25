import { reportStorageFailure } from "./storage-logging";
import { THESIS_DIRECTIONS, THESIS_STAGES } from "../../../domain/contracts";
import type {
  DailyBriefExemption,
  DailyBriefFrozenVersionFact,
  DailyBriefGateResult,
  DailyBriefResult,
  DailyBriefSourceHealthSnapshot,
  DailyBriefVersionTarget,
  FrozenDailyBriefVersion,
  RequiredDailyThesisId,
} from "../../../domain/daily-brief";
import {
  DAILY_BRIEF_GATE_CODES,
  REQUIRED_DAILY_THESIS_IDS,
  dailyBriefFreezeKey,
  evaluateDailyBriefGates,
  highRiskTriggers,
} from "../../../domain/daily-brief";
import { SOURCE_ERROR_CODES } from "../../../domain/ingestion";
import { calculateSourceHealth } from "../../ingestion/source-health";
import type { DailyBriefMutation, DailyBriefRepository } from "../../modules/daily-briefs";
import { DailyBriefError } from "../../modules/daily-briefs";

const READ_FACT_STATEMENT_COUNT = 6;
const PUBLISHED_READ_STATEMENT_COUNT = 5;
const LEGACY_DAILY_BRIEF_FREEZE_PREFIX = "daily-brief-freeze-legacy-v1:";

interface VersionGuard {
  readonly id: string;
  readonly thesisId: string;
  readonly version: number;
  readonly status: string;
  readonly direction: string;
  readonly stage: string;
  readonly confidence: number;
  readonly basedOnCutoff: string;
  readonly calculationJson: string;
}

interface EvidenceGuard {
  readonly id: string;
  readonly versionId: string;
  readonly citationUrl: string;
  readonly sortOrder: number;
}

interface SourceGuard {
  readonly id: string;
  readonly lastSuccessAt: string | null;
  readonly lateAfterMinutes: number;
  readonly staleAfterMinutes: number;
  readonly consecutiveFailures: number;
  readonly lastErrorCode: string | null;
  readonly ambiguousRetryRewrites: number;
}

interface ReviewGuard {
  readonly thesisId: string;
  readonly beforeVersionId: string;
  readonly afterVersionId: string;
  readonly status: string;
  readonly reviewedBy: string | null;
  readonly reviewedAt: string | null;
  readonly reason: string | null;
}

interface PreviousBriefGuard {
  readonly briefDate: string;
  readonly thesisId: string;
  readonly thesisVersionId: string;
  readonly direction: string;
  readonly stage: string;
  readonly confidence: number;
}

/**
 * A high-risk transition that still needs a recorded review before the daily brief can publish.
 * Exposing this lets an operator record the exact previous/target binding without inspecting D1.
 */
export interface PendingReviewObligation {
  readonly thesisId: RequiredDailyThesisId;
  readonly afterVersionId: string;
  readonly beforeVersionId: string;
  readonly triggers: readonly string[];
}

export class D1DailyBriefRepository implements DailyBriefRepository {
  constructor(private readonly database: D1Database) {}

  async freezeAndPublish(mutation: DailyBriefMutation): Promise<DailyBriefResult> {
    assertMutation(mutation);
    try {
      const facts = await this.readGateFacts(mutation);
      const gates = evaluateDailyBriefGates({
        cutoff: mutation.cutoff,
        targets: mutation.targets,
        versions: facts.versions,
        sourceHealth: facts.sourceHealth,
        exemptions: mutation.exemptions,
      });
      const freezeKey = await dailyBriefFreezeKey({
        briefDate: mutation.briefDate,
        cutoff: mutation.cutoff,
        targets: mutation.targets,
        headline: mutation.headline,
        summary: mutation.summary,
        topChanges: mutation.topChanges,
        versions: facts.versions,
        sourceHealth: facts.sourceHealth,
        exemptions: mutation.exemptions,
      });

      const exact = await this.findAttemptByFreezeKey(freezeKey);
      if (exact !== null) return exact;
      const current = await this.findLatestAttempt(mutation.briefDate);
      if (current !== null && mutation.expectedFreezeKey !== current.freezeKey) {
        throw conflict(mutation.expectedFreezeKey, current.freezeKey);
      }
      if (current === null && mutation.expectedFreezeKey !== null) {
        throw conflict(mutation.expectedFreezeKey, null);
      }
      const alreadyPublished = await this.findPublished(mutation.briefDate);
      if (alreadyPublished !== null) {
        throw new DailyBriefError("IMMUTABLE", "该日期的每日判定已经发布且不可替换");
      }

      const frozenVersions = frozenVersionsFromFacts(facts.versions);
      const allPassed = gates.every((gate) => gate.status === "passed");
      const result = allPassed
        ? await this.writePublished(
          mutation,
          freezeKey,
          gates,
          facts.sourceHealth,
          frozenVersions,
          facts.versionGuards,
          facts.evidenceGuards,
          facts.sourceGuards,
          facts.reviewGuards,
          facts.previousGuards,
        )
        : await this.writeDelayed(mutation, freezeKey, gates, facts.sourceHealth, frozenVersions);
      return result;
    } catch (error) {
      if (error instanceof DailyBriefError) throw error;
      reportStorageFailure("daily-briefs.freezeAndPublish", error);
      throw databaseError();
    }
  }

  async findCurrentFreezeKey(briefDate: string): Promise<string | null> {
    try {
      calendarDate(briefDate);
      const row = await this.database.prepare(
        `SELECT attempt.freeze_key AS freeze_key
           FROM daily_brief_attempts attempt
          WHERE attempt.brief_date = ?
          ORDER BY attempt.created_at DESC, attempt.rowid DESC
          LIMIT 1`,
      ).bind(briefDate).first<{ freeze_key: unknown }>();
      if (row === null) return null;
      const freezeKey = row.freeze_key;
      if (typeof freezeKey !== "string" || freezeKey.trim().length === 0) throw databaseError();
      return freezeKey;
    } catch (error) {
      if (error instanceof DailyBriefError) throw error;
      reportStorageFailure("daily-briefs.findCurrentFreezeKey", error);
      throw databaseError();
    }
  }

  /**
   * 高风险转场审核待办（相对上一期已发布 brief）。只回传稳定的论点/版本身份与触发枚举，供后台在
   * 发布前记录精确审核；不参与冻结计算，也不替代任何研究判断。
   */
  async findPendingReviewObligations(
    briefDate: string,
    versionIds: readonly string[],
  ): Promise<readonly PendingReviewObligation[]> {
    if (versionIds.length === 0) return [];
    try {
      calendarDate(briefDate);
      const placeholders = versionIds.map(() => "?").join(", ");
      const result = await this.database.prepare(
        `SELECT target.thesis_id, target.id AS thesis_version_id,
                target.direction, target.stage, target.confidence,
                prior.thesis_version_id AS before_version_id,
                prior_version.direction AS prior_direction,
                prior_version.stage AS prior_stage,
                prior_version.confidence AS prior_confidence,
                matched_review.status AS matched_review_status
           FROM thesis_versions target
           LEFT JOIN daily_brief_theses prior
             ON prior.thesis_id = target.thesis_id
            AND prior.brief_date = (
              SELECT MAX(brief.brief_date) FROM daily_briefs brief
               WHERE brief.status = 'published' AND brief.brief_date < ?
            )
           LEFT JOIN thesis_versions prior_version
             ON prior_version.id = prior.thesis_version_id
            AND prior_version.thesis_id = prior.thesis_id
           LEFT JOIN thesis_change_reviews matched_review
             ON matched_review.after_version_id = target.id
            AND matched_review.thesis_id = target.thesis_id
            AND matched_review.before_version_id = prior.thesis_version_id
            AND matched_review.status = 'approved'
          WHERE target.id IN (${placeholders})
          ORDER BY target.thesis_id`,
      ).bind(briefDate, ...versionIds).all<Record<string, unknown>>();
      if (result.success !== true || !Array.isArray(result.results)) throw databaseError();
      return deepFreeze(result.results.flatMap(decodePendingReviewObligation));
    } catch (error) {
      if (error instanceof DailyBriefError) throw error;
      reportStorageFailure("daily-briefs.findPendingReviewObligations", error);
      throw databaseError();
    }
  }

  async findPublished(briefDate: string): Promise<DailyBriefResult | null> {
    try {
      calendarDate(briefDate);
      const results = await this.database.batch<Record<string, unknown>>([
        this.database.prepare(
          `SELECT brief.brief_date, brief.status, brief.freeze_key, brief.headline, brief.summary,
                  brief.top_changes_json, brief.data_cutoff, brief.methodology_snapshot_json,
                  brief.rule_snapshot_json, brief.source_health_snapshot_json,
                  brief.publication_attempt_id, brief.published_at, brief.published_by
             FROM daily_briefs brief
            WHERE brief.brief_date = ? AND brief.status = 'published'
            LIMIT 1`,
        ).bind(briefDate),
        this.database.prepare(
          `SELECT links.brief_date, links.thesis_id, links.thesis_version_id,
                  links.methodology_version, links.rule_version, links.sort_order,
                  version.version, version.status, version.based_on_cutoff, version.calculation_json
             FROM daily_brief_theses links
             JOIN thesis_versions version
               ON version.id = links.thesis_version_id
              AND version.thesis_id = links.thesis_id
              AND version.status IN ('published', 'withdrawn')
            WHERE links.brief_date = ?
            ORDER BY links.sort_order`,
        ).bind(briefDate),
        this.database.prepare(
          `SELECT attempt.id, attempt.brief_date, attempt.freeze_key, attempt.outcome,
                  attempt.data_cutoff, attempt.headline, attempt.summary, attempt.top_changes_json,
                  attempt.source_health_snapshot_json, attempt.actor, attempt.created_at
             FROM daily_brief_attempts attempt
             JOIN daily_briefs brief ON brief.publication_attempt_id = attempt.id
            WHERE brief.brief_date = ? AND attempt.outcome = 'published'
            LIMIT 1`,
        ).bind(briefDate),
        this.gatesForBriefStatement(briefDate),
        this.exemptionsForBriefStatement(briefDate),
      ]);
      if (!Array.isArray(results) || results.length !== PUBLISHED_READ_STATEMENT_COUNT) throw databaseError();
      const briefRows = queryRows(results[0]);
      const linkRows = queryRows(results[1]);
      const attemptRows = queryRows(results[2]);
      const gateRows = queryRows(results[3]);
      const exemptionRows = queryRows(results[4]);
      if (briefRows.length === 0) {
        if (
          linkRows.length !== 0
          || attemptRows.length !== 0
          || gateRows.length !== 0
          || exemptionRows.length !== 0
        ) {
          throw databaseError();
        }
        return null;
      }
      if (briefRows.length !== 1 || attemptRows.length !== 1) throw databaseError();
      const exemptions = decodeExemptions(exemptionRows);
      const result = decodePublishedResult(briefRows[0]!, linkRows, attemptRows[0]!, gateRows, exemptions);
      if (result.briefDate !== briefDate) throw databaseError();
      return result;
    } catch (error) {
      if (error instanceof DailyBriefError) throw error;
      throw databaseError();
    }
  }

  private async readGateFacts(mutation: DailyBriefMutation): Promise<{
    readonly versions: readonly DailyBriefFrozenVersionFact[];
    readonly sourceHealth: readonly DailyBriefSourceHealthSnapshot[];
    readonly versionGuards: readonly VersionGuard[];
    readonly evidenceGuards: readonly EvidenceGuard[];
    readonly sourceGuards: readonly SourceGuard[];
    readonly reviewGuards: readonly ReviewGuard[];
    readonly previousGuards: readonly PreviousBriefGuard[];
  }> {
    const versionIds = mutation.targets.map((target) => target.thesisVersionId);
    const placeholders = versionIds.map(() => "?").join(", ");
    const results = await this.database.batch<Record<string, unknown>>([
      this.database.prepare(
        `SELECT version.id, version.thesis_id, version.version, version.status,
                version.direction, version.stage, version.confidence,
                version.based_on_cutoff, version.calculation_json,
                (SELECT MAX(latest.version) FROM thesis_versions latest
                  WHERE latest.thesis_id = version.thesis_id) AS latest_version
           FROM thesis_versions version
          WHERE version.id IN (${placeholders})
          ORDER BY version.thesis_id`,
      ).bind(...versionIds),
      this.database.prepare(
        `SELECT evidence.id, evidence.thesis_version_id, evidence.citation_url, evidence.sort_order
           FROM evidence
          WHERE evidence.thesis_version_id IN (${placeholders})
          ORDER BY evidence.thesis_version_id, evidence.sort_order, evidence.id`,
      ).bind(...versionIds),
      this.database.prepare(
        `SELECT source.id, source.late_after_minutes, source.stale_after_minutes,
                (
                  SELECT successful.finished_at
                    FROM source_runs successful
                   WHERE successful.source_id = source.id
                     AND successful.finished_at IS NOT NULL
                     AND successful.finished_at <= ?
                     AND successful.status IN ('success', 'unchanged')
                   ORDER BY successful.finished_at DESC, successful.started_at DESC,
                            successful.id DESC
                   LIMIT 1
                ) AS last_success_at,
                (
                  SELECT COALESCE(SUM(failed.retry_count + 1), 0)
                    FROM source_runs failed
                   WHERE failed.source_id = source.id
                     AND failed.finished_at IS NOT NULL
                     AND failed.finished_at <= ?
                     AND failed.status = 'failed'
                     AND failed.finished_at > COALESCE((
                       SELECT successful.finished_at
                         FROM source_runs successful
                        WHERE successful.source_id = source.id
                          AND successful.finished_at IS NOT NULL
                          AND successful.finished_at <= ?
                          AND successful.status IN ('success', 'unchanged')
                        ORDER BY successful.finished_at DESC, successful.started_at DESC,
                                 successful.id DESC
                        LIMIT 1
                     ), '')
                ) AS consecutive_failures,
                (
                  SELECT CASE WHEN latest.status = 'failed' THEN latest.error_code ELSE NULL END
                    FROM source_runs latest
                   WHERE latest.source_id = source.id
                     AND latest.finished_at IS NOT NULL
                     AND latest.finished_at <= ?
                     AND latest.status <> 'partial'
                   ORDER BY latest.finished_at DESC, latest.started_at DESC, latest.id DESC
                   LIMIT 1
                ) AS last_error_code,
                (
                  SELECT COUNT(*)
                    FROM source_runs rewritten
                   WHERE rewritten.source_id = source.id
                     AND rewritten.retry_count > 0
                     AND rewritten.scheduled_at <= ?
                     AND rewritten.finished_at > ?
                ) AS ambiguous_retry_rewrites
           FROM sources source
          WHERE source.enabled = 1
          ORDER BY source.id`,
      ).bind(
        mutation.cutoff,
        mutation.cutoff,
        mutation.cutoff,
        mutation.cutoff,
        mutation.cutoff,
        mutation.cutoff,
      ),
      this.database.prepare(
        `WITH previous_brief AS (
           SELECT MAX(brief_date) AS brief_date
             FROM daily_briefs
            WHERE status = 'published' AND brief_date < ?
         )
         SELECT links.brief_date, links.thesis_id, links.thesis_version_id, version.direction,
                version.stage, version.confidence
           FROM daily_brief_theses links
           JOIN previous_brief ON previous_brief.brief_date = links.brief_date
           JOIN thesis_versions version
             ON version.id = links.thesis_version_id AND version.thesis_id = links.thesis_id
          ORDER BY links.thesis_id`,
      ).bind(mutation.briefDate),
      this.database.prepare(
        `SELECT review.thesis_id, review.before_version_id, review.after_version_id,
                review.status, review.reviewed_by, review.reviewed_at, review.reason
           FROM thesis_change_reviews review
          WHERE review.after_version_id IN (${placeholders})
          ORDER BY review.thesis_id`,
      ).bind(...versionIds),
      this.database.prepare(
        `WITH previous_brief AS (
           SELECT MAX(brief_date) AS brief_date
             FROM daily_briefs
            WHERE status = 'published' AND brief_date < ?
         )
         SELECT exemption.thesis_id, exemption.gap_id
           FROM daily_brief_exemptions exemption
           JOIN previous_brief ON previous_brief.brief_date = exemption.brief_date
          ORDER BY exemption.thesis_id`,
      ).bind(mutation.briefDate),
    ]);
    if (!Array.isArray(results) || results.length !== READ_FACT_STATEMENT_COUNT) throw databaseError();
    const versionRows = queryRows(results[0]);
    const evidenceRows = queryRows(results[1]);
    const sourceRows = queryRows(results[2]);
    const previousRows = queryRows(results[3]);
    const reviewRows = queryRows(results[4]);
    const previousExemptionRows = queryRows(results[5]);

    const citations = decodeCitations(evidenceRows, new Set(versionIds));
    const previousExemptions = decodeExemptions(previousExemptionRows);
    const previous = decodePrevious(previousRows, previousExemptions);
    const reviews = decodeReviews(reviewRows, new Set(versionIds), mutation.occurredAt);
    const versions = versionRows.map((row) =>
      decodeVersionFact(row, mutation.targets, mutation.cutoff, citations, previous, reviews),
    );
    const sourceGuards = sourceRows.map(decodeSourceGuard);
    if (sourceGuards.some(({ ambiguousRetryRewrites }) => ambiguousRetryRewrites > 0)) {
      throw databaseError();
    }
    const sourceHealth = sourceRows.map((row) => decodeSourceHealth(row, mutation.cutoff));
    return {
      versions: deepFreeze(versions),
      sourceHealth: deepFreeze(sourceHealth),
      versionGuards: deepFreeze(versionRows.map(decodeVersionGuard)),
      evidenceGuards: deepFreeze(evidenceRows.map(decodeEvidenceGuard)),
      sourceGuards: deepFreeze(sourceGuards),
      reviewGuards: deepFreeze(reviewRows.map(decodeReviewGuard)),
      previousGuards: deepFreeze(previousRows.map(decodePreviousGuard)),
    };
  }

  private async writeDelayed(
    mutation: DailyBriefMutation,
    freezeKey: string,
    gates: readonly DailyBriefGateResult[],
    sourceHealth: readonly DailyBriefSourceHealthSnapshot[],
    versions: readonly FrozenDailyBriefVersion[],
  ): Promise<DailyBriefResult> {
    const statements = [
      this.attemptStatement(mutation, freezeKey, "delayed", sourceHealth, versions),
      ...gates.map((gate) => this.gateStatement(mutation.attemptId, gate)),
    ];
    const stages = ["attempt", ...gates.map((gate) => `gate:${gate.code}`)];
    try {
      assertWriteBatch(await this.database.batch(statements), stages);
    } catch (error) {
      const raced = await this.findAttemptByFreezeKey(freezeKey);
      if (raced !== null) return raced;
      const current = await this.findLatestAttempt(mutation.briefDate);
      if (current !== null && mutation.expectedFreezeKey !== current.freezeKey) {
        throw conflict(mutation.expectedFreezeKey, current.freezeKey);
      }
      // Freeze keys agree, so this is not a concurrency race: report the guarded stage that failed.
      const staged = guardedStageError(error);
      if (staged !== null) {
        reportStorageFailure("daily-briefs.writeDelayed", error);
        throw staged;
      }
      reportStorageFailure("daily-briefs.writeDelayed", error);
      throw error instanceof DailyBriefError ? error : databaseError({ stage: "batch" });
    }
    return deepFreeze({
      briefDate: mutation.briefDate,
      status: "delayed",
      freezeKey,
      cutoff: mutation.cutoff,
      headline: mutation.headline,
      summary: mutation.summary,
      topChanges: [...mutation.topChanges],
      gates,
      sourceHealth,
      versions,
      exemptions: [],
      publishedAt: null,
      publishedBy: null,
      attemptId: mutation.attemptId,
    });
  }

  private async writePublished(
    mutation: DailyBriefMutation,
    freezeKey: string,
    gates: readonly DailyBriefGateResult[],
    sourceHealth: readonly DailyBriefSourceHealthSnapshot[],
    versions: readonly FrozenDailyBriefVersion[],
    versionGuards: readonly VersionGuard[],
    evidenceGuards: readonly EvidenceGuard[],
    sourceGuards: readonly SourceGuard[],
    reviewGuards: readonly ReviewGuard[],
    previousGuards: readonly PreviousBriefGuard[],
  ): Promise<DailyBriefResult> {
    if (versions.length + mutation.exemptions.length !== REQUIRED_DAILY_THESIS_IDS.length) {
      throw databaseError();
    }
    const methodologySnapshot = versions.map(({ thesisId, methodologyVersion }) => ({
      thesisId, methodologyVersion,
    }));
    const ruleSnapshot = versions.map(({ thesisId, ruleVersion }) => ({ thesisId, ruleVersion }));
    const statements: D1PreparedStatement[] = [
      this.guardedPublicationAttemptStatement(
        mutation,
        freezeKey,
        sourceHealth,
        versions,
        versionGuards,
        evidenceGuards,
        sourceGuards,
        reviewGuards,
        previousGuards,
      ),
      ...gates.map((gate) => this.gateStatement(mutation.attemptId, gate)),
      this.database.prepare(
        `INSERT INTO daily_briefs (
           brief_date, status, headline, summary, top_changes_json, data_cutoff,
           published_at, published_by, freeze_key, methodology_snapshot_json,
           rule_snapshot_json, source_health_snapshot_json, publication_attempt_id
         ) VALUES (?, 'draft', ?, ?, ?, ?, NULL, NULL, ?, ?, ?, ?, ?)`,
      ).bind(
        mutation.briefDate,
        mutation.headline,
        mutation.summary,
        JSON.stringify(mutation.topChanges),
        mutation.cutoff,
        freezeKey,
        JSON.stringify(methodologySnapshot),
        JSON.stringify(ruleSnapshot),
        JSON.stringify(sourceHealth),
        mutation.attemptId,
      ),
      ...versions.map((version) => this.database.prepare(
        `INSERT INTO daily_brief_theses (
           brief_date, thesis_id, thesis_version_id, methodology_version, rule_version, sort_order
         ) SELECT ?, ?, version.id, ?, ?, ?
             FROM thesis_versions version
            WHERE version.id = ? AND version.thesis_id = ? AND version.status = 'published'`,
      ).bind(
        mutation.briefDate,
        version.thesisId,
        version.methodologyVersion,
        version.ruleVersion,
        version.sortOrder,
        version.thesisVersionId,
        version.thesisId,
      )),
      // 路径①：豁免行必须先于 `status = 'published'` 写入，0010 的发布触发器才能看到
      // 「已发布版本 + 已登记豁免 = 6」。写入条件与随后的 UPDATE 完全一致（同一 draft /
      // freeze_key / attempt），因此两者要么都生效，要么都写 0 行，不会留下孤儿豁免。
      ...mutation.exemptions.map((exemption) => this.database.prepare(
        `INSERT INTO daily_brief_exemptions (
           brief_date, thesis_id, gap_id, acknowledged_by, acknowledged_at
         ) SELECT ?, ?, ?, ?, ?
            WHERE EXISTS (
              SELECT 1 FROM daily_briefs brief
               WHERE brief.brief_date = ? AND brief.status = 'draft'
                 AND brief.freeze_key = ? AND brief.publication_attempt_id = ?
            )`,
      ).bind(
        mutation.briefDate,
        exemption.thesisId,
        exemption.gapId,
        mutation.actor,
        mutation.occurredAt,
        mutation.briefDate,
        freezeKey,
        mutation.attemptId,
      )),
      this.database.prepare(
        `UPDATE daily_briefs
            SET status = 'published', published_at = ?, published_by = ?
          WHERE brief_date = ? AND status = 'draft' AND freeze_key = ?
            AND publication_attempt_id = ?`,
      ).bind(mutation.occurredAt, mutation.actor, mutation.briefDate, freezeKey, mutation.attemptId),
      this.database.prepare(
        `INSERT INTO audit_log (
           id, entity_type, entity_id, action, actor, reason, before_json, after_json, created_at
         ) SELECT ?, 'daily_brief', brief.brief_date, 'publish', ?, ?, NULL,
                  json_object(
                    'freezeKey', brief.freeze_key,
                    'attemptId', brief.publication_attempt_id,
                    'exemptions', (
                      SELECT json_group_array(json_object('thesisId', exemption.thesis_id, 'gapId', exemption.gap_id))
                        FROM daily_brief_exemptions exemption
                       WHERE exemption.brief_date = brief.brief_date
                    )
                  ), ?
             FROM daily_briefs brief
            WHERE brief.brief_date = ? AND brief.status = 'published'
              AND brief.freeze_key = ? AND brief.publication_attempt_id = ?`,
      ).bind(
        mutation.auditId,
        mutation.actor,
        mutation.reason,
        mutation.occurredAt,
        mutation.briefDate,
        freezeKey,
        mutation.attemptId,
      ),
    ];
    const stages = [
      "guarded-attempt",
      ...gates.map((gate) => `gate:${gate.code}`),
      "brief-insert",
      ...versions.map((version) => `link:${version.thesisId}`),
      ...mutation.exemptions.map((exemption) => `exemption:${exemption.thesisId}`),
      "brief-publish",
      "audit",
    ];
    try {
      assertWriteBatch(await this.database.batch(statements), stages);
    } catch (error) {
      const raced = await this.findAttemptByFreezeKey(freezeKey);
      if (raced !== null) return raced;
      const current = await this.findLatestAttempt(mutation.briefDate);
      if (current !== null && mutation.expectedFreezeKey !== current.freezeKey) {
        throw conflict(mutation.expectedFreezeKey, current.freezeKey);
      }
      // See writeDelayed: a guard that did not take effect is a write failure with a stage, not a
      // concurrency conflict. Misreporting it as VERSION_CONFLICT hid the real cause in staging.
      const staged = guardedStageError(error);
      if (staged !== null) {
        reportStorageFailure("daily-briefs.writePublished", error);
        throw staged;
      }
      // A constraint or trigger rejected the batch (for example a stale publish trigger that does
      // not yet accept exemptions): label it so it is never mistaken for a concurrency conflict.
      reportStorageFailure("daily-briefs.writePublished", error);
      throw error instanceof DailyBriefError ? error : databaseError({ stage: "batch" });
    }
    const published = await this.findPublished(mutation.briefDate);
    if (published === null || published.freezeKey !== freezeKey || published.attemptId !== mutation.attemptId) {
      throw databaseError();
    }
    return published;
  }

  private guardedPublicationAttemptStatement(
    mutation: DailyBriefMutation,
    freezeKey: string,
    sourceHealth: readonly DailyBriefSourceHealthSnapshot[],
    versions: readonly FrozenDailyBriefVersion[],
    versionGuards: readonly VersionGuard[],
    evidenceGuards: readonly EvidenceGuard[],
    sourceGuards: readonly SourceGuard[],
    reviewGuards: readonly ReviewGuard[],
    previousGuards: readonly PreviousBriefGuard[],
  ): D1PreparedStatement {
    if (
      versionGuards.length !== versions.length
      || sourceGuards.length !== sourceHealth.length
      || sourceGuards.length === 0
      || (previousGuards.length !== 0 && previousGuards.length > REQUIRED_DAILY_THESIS_IDS.length)
    ) throw databaseError();
    const versionGuardJson = JSON.stringify(versionGuards);
    const evidenceGuardJson = JSON.stringify(evidenceGuards);
    const sourceGuardJson = JSON.stringify(sourceGuards);
    const reviewGuardJson = JSON.stringify(reviewGuards);
    const previousGuardJson = JSON.stringify(previousGuards);
    const statement = this.database.prepare(
      `INSERT INTO daily_brief_attempts (
         id, brief_date, freeze_key, outcome, data_cutoff, headline, summary,
         top_changes_json, target_snapshot_json, methodology_snapshot_json,
         rule_snapshot_json, source_health_snapshot_json, actor, reason, created_at
       ) SELECT ?, ?, ?, 'published', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?
          WHERE COALESCE((
            SELECT latest_attempt.freeze_key
              FROM daily_brief_attempts latest_attempt
             WHERE latest_attempt.brief_date = ?
             ORDER BY latest_attempt.created_at DESC, latest_attempt.rowid DESC
             LIMIT 1
          ), '') = COALESCE(?, '')
            AND NOT EXISTS (
              SELECT 1 FROM daily_briefs existing
               WHERE existing.brief_date = ? AND existing.status = 'published'
            )
            AND (
            SELECT COUNT(*)
              FROM json_each(?) guard
              JOIN thesis_versions guarded
                ON guarded.id = json_extract(guard.value, '$.id')
               AND guarded.thesis_id = json_extract(guard.value, '$.thesisId')
               AND guarded.version = json_extract(guard.value, '$.version')
               AND guarded.status = json_extract(guard.value, '$.status')
               AND guarded.direction = json_extract(guard.value, '$.direction')
               AND guarded.stage = json_extract(guard.value, '$.stage')
               AND guarded.confidence = json_extract(guard.value, '$.confidence')
               AND guarded.based_on_cutoff = json_extract(guard.value, '$.basedOnCutoff')
               AND guarded.calculation_json = json_extract(guard.value, '$.calculationJson')
             WHERE guarded.version = (
               SELECT MAX(latest.version) FROM thesis_versions latest
                WHERE latest.thesis_id = guarded.thesis_id
             )
          ) = ?
            AND (
              SELECT COUNT(*) FROM evidence guarded_evidence
               WHERE guarded_evidence.thesis_version_id IN (
                 SELECT json_extract(value, '$.id') FROM json_each(?)
               )
            ) = json_array_length(?)
            AND NOT EXISTS (
              SELECT 1 FROM json_each(?) guard
               WHERE NOT EXISTS (
                 SELECT 1 FROM evidence guarded_evidence
                  WHERE guarded_evidence.id = json_extract(guard.value, '$.id')
                    AND guarded_evidence.thesis_version_id = json_extract(guard.value, '$.versionId')
                    AND guarded_evidence.sort_order = json_extract(guard.value, '$.sortOrder')
                    AND guarded_evidence.citation_url = json_extract(guard.value, '$.citationUrl')
               )
            )
            AND (SELECT COUNT(*) FROM sources WHERE enabled = 1) = json_array_length(?)
            AND NOT EXISTS (
              SELECT 1 FROM json_each(?) guard
               WHERE NOT EXISTS (
                 SELECT 1 FROM sources guarded_source
                 WHERE guarded_source.id = json_extract(guard.value, '$.id')
                    AND guarded_source.enabled = 1
                    AND guarded_source.late_after_minutes = json_extract(guard.value, '$.lateAfterMinutes')
                    AND guarded_source.stale_after_minutes = json_extract(guard.value, '$.staleAfterMinutes')
                    AND (
                      SELECT successful.finished_at
                        FROM source_runs successful
                       WHERE successful.source_id = guarded_source.id
                         AND successful.finished_at IS NOT NULL
                         AND successful.finished_at <= ?
                         AND successful.status IN ('success', 'unchanged')
                       ORDER BY successful.finished_at DESC, successful.started_at DESC,
                                successful.id DESC
                       LIMIT 1
                    ) IS json_extract(guard.value, '$.lastSuccessAt')
                    AND (
                      SELECT COALESCE(SUM(failed.retry_count + 1), 0)
                        FROM source_runs failed
                       WHERE failed.source_id = guarded_source.id
                         AND failed.finished_at IS NOT NULL
                         AND failed.finished_at <= ?
                         AND failed.status = 'failed'
                         AND failed.finished_at > COALESCE((
                           SELECT successful.finished_at
                             FROM source_runs successful
                            WHERE successful.source_id = guarded_source.id
                              AND successful.finished_at IS NOT NULL
                              AND successful.finished_at <= ?
                              AND successful.status IN ('success', 'unchanged')
                            ORDER BY successful.finished_at DESC, successful.started_at DESC,
                                     successful.id DESC
                            LIMIT 1
                         ), '')
                    ) = json_extract(guard.value, '$.consecutiveFailures')
                    AND (
                      SELECT CASE WHEN latest.status = 'failed' THEN latest.error_code ELSE NULL END
                        FROM source_runs latest
                       WHERE latest.source_id = guarded_source.id
                         AND latest.finished_at IS NOT NULL
                         AND latest.finished_at <= ?
                         AND latest.status <> 'partial'
                       ORDER BY latest.finished_at DESC, latest.started_at DESC, latest.id DESC
                       LIMIT 1
                    ) IS json_extract(guard.value, '$.lastErrorCode')
                    AND (
                      SELECT COUNT(*)
                        FROM source_runs rewritten
                       WHERE rewritten.source_id = guarded_source.id
                         AND rewritten.retry_count > 0
                         AND rewritten.scheduled_at <= ?
                         AND rewritten.finished_at > ?
                    ) = json_extract(guard.value, '$.ambiguousRetryRewrites')
               )
            )
            AND NOT EXISTS (
              SELECT 1 FROM json_each(?) guard
               WHERE NOT EXISTS (
                 SELECT 1 FROM thesis_change_reviews guarded_review
                  WHERE guarded_review.thesis_id = json_extract(guard.value, '$.thesisId')
                    AND guarded_review.before_version_id = json_extract(guard.value, '$.beforeVersionId')
                    AND guarded_review.after_version_id = json_extract(guard.value, '$.afterVersionId')
                    AND guarded_review.status = json_extract(guard.value, '$.status')
                    AND guarded_review.reviewed_by IS json_extract(guard.value, '$.reviewedBy')
                    AND guarded_review.reviewed_at IS json_extract(guard.value, '$.reviewedAt')
                    AND guarded_review.reason IS json_extract(guard.value, '$.reason')
               )
            )
            AND (
              (
                json_array_length(?) = 0
                AND NOT EXISTS (
                  SELECT 1 FROM daily_briefs prior
                   WHERE prior.status = 'published' AND prior.brief_date < ?
                )
              )
              OR (
                json_array_length(?) > 0
                AND (
                  SELECT MAX(prior.brief_date) FROM daily_briefs prior
                   WHERE prior.status = 'published' AND prior.brief_date < ?
                ) = json_extract(?, '$[0].briefDate')
                AND (
                  SELECT COUNT(*)
                    FROM daily_brief_theses prior_link
                    JOIN daily_briefs prior
                      ON prior.brief_date = prior_link.brief_date
                     AND prior.status = 'published'
                    JOIN thesis_versions prior_version
                      ON prior_version.id = prior_link.thesis_version_id
                     AND prior_version.thesis_id = prior_link.thesis_id
                   WHERE prior_link.brief_date = json_extract(?, '$[0].briefDate')
                ) = json_array_length(?)
                AND NOT EXISTS (
                  SELECT 1 FROM json_each(?) guard
                   WHERE NOT EXISTS (
                     SELECT 1
                       FROM daily_brief_theses prior_link
                       JOIN daily_briefs prior
                         ON prior.brief_date = prior_link.brief_date
                        AND prior.status = 'published'
                       JOIN thesis_versions prior_version
                         ON prior_version.id = prior_link.thesis_version_id
                        AND prior_version.thesis_id = prior_link.thesis_id
                      WHERE prior_link.brief_date = json_extract(guard.value, '$.briefDate')
                        AND prior_link.thesis_id = json_extract(guard.value, '$.thesisId')
                        AND prior_link.thesis_version_id = json_extract(guard.value, '$.thesisVersionId')
                        AND prior_version.direction = json_extract(guard.value, '$.direction')
                        AND prior_version.stage = json_extract(guard.value, '$.stage')
                        AND prior_version.confidence = json_extract(guard.value, '$.confidence')
                   )
                )
              )
            )`,
    );
    return statement.bind(
      mutation.attemptId,
      mutation.briefDate,
      freezeKey,
      mutation.cutoff,
      mutation.headline,
      mutation.summary,
      JSON.stringify(mutation.topChanges),
      JSON.stringify(versions.map(({ thesisId, thesisVersionId, version, sortOrder }) => ({
        thesisId, thesisVersionId, version, sortOrder,
      }))),
      JSON.stringify(versions.map(({ thesisId, methodologyVersion }) => ({ thesisId, methodologyVersion }))),
      JSON.stringify(versions.map(({ thesisId, ruleVersion }) => ({ thesisId, ruleVersion }))),
      JSON.stringify(sourceHealth),
      mutation.actor,
      mutation.reason,
      mutation.occurredAt,
      mutation.briefDate,
      mutation.expectedFreezeKey,
      mutation.briefDate,
      versionGuardJson,
      versions.length,
      versionGuardJson,
      evidenceGuardJson,
      evidenceGuardJson,
      sourceGuardJson,
      sourceGuardJson,
      mutation.cutoff,
      mutation.cutoff,
      mutation.cutoff,
      mutation.cutoff,
      mutation.cutoff,
      mutation.cutoff,
      reviewGuardJson,
      previousGuardJson,
      mutation.briefDate,
      previousGuardJson,
      mutation.briefDate,
      previousGuardJson,
      previousGuardJson,
      previousGuardJson,
      previousGuardJson,
    );
  }

  private attemptStatement(
    mutation: DailyBriefMutation,
    freezeKey: string,
    outcome: "published" | "delayed",
    sourceHealth: readonly DailyBriefSourceHealthSnapshot[],
    versions: readonly FrozenDailyBriefVersion[],
  ): D1PreparedStatement {
    return this.database.prepare(
      `INSERT INTO daily_brief_attempts (
         id, brief_date, freeze_key, outcome, data_cutoff, headline, summary,
         top_changes_json, target_snapshot_json, methodology_snapshot_json,
         rule_snapshot_json, source_health_snapshot_json, actor, reason, created_at
       ) SELECT ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?
          WHERE COALESCE((
            SELECT latest_attempt.freeze_key
              FROM daily_brief_attempts latest_attempt
             WHERE latest_attempt.brief_date = ?
             ORDER BY latest_attempt.created_at DESC, latest_attempt.rowid DESC
             LIMIT 1
          ), '') = COALESCE(?, '')
            AND NOT EXISTS (
              SELECT 1 FROM daily_briefs existing
               WHERE existing.brief_date = ? AND existing.status = 'published'
            )`,
    ).bind(
      mutation.attemptId,
      mutation.briefDate,
      freezeKey,
      outcome,
      mutation.cutoff,
      mutation.headline,
      mutation.summary,
      JSON.stringify(mutation.topChanges),
      JSON.stringify(versions.map(({ thesisId, thesisVersionId, version, sortOrder }) => ({
        thesisId, thesisVersionId, version, sortOrder,
      }))),
      JSON.stringify(versions.map(({ thesisId, methodologyVersion }) => ({ thesisId, methodologyVersion }))),
      JSON.stringify(versions.map(({ thesisId, ruleVersion }) => ({ thesisId, ruleVersion }))),
      JSON.stringify(sourceHealth),
      mutation.actor,
      mutation.reason,
      mutation.occurredAt,
      mutation.briefDate,
      mutation.expectedFreezeKey,
      mutation.briefDate,
    );
  }

  private gateStatement(attemptId: string, gate: DailyBriefGateResult): D1PreparedStatement {
    return this.database.prepare(
      `INSERT INTO daily_brief_gate_results (
         attempt_id, gate_code, status, explanation, reasons_json
       ) VALUES (?, ?, ?, ?, ?)`,
    ).bind(attemptId, gate.code, gate.status, gate.explanation, JSON.stringify(gate.reasons));
  }

  private gatesForBriefStatement(briefDate: string): D1PreparedStatement {
    return this.database.prepare(
      `SELECT gate.attempt_id, gate.gate_code, gate.status, gate.explanation, gate.reasons_json
         FROM daily_brief_gate_results gate
         JOIN daily_briefs brief ON brief.publication_attempt_id = gate.attempt_id
        WHERE brief.brief_date = ?
        ORDER BY gate.gate_code`,
    ).bind(briefDate);
  }

  private exemptionsForBriefStatement(briefDate: string): D1PreparedStatement {
    return this.database.prepare(
      `SELECT exemption.thesis_id, exemption.gap_id
         FROM daily_brief_exemptions exemption
        WHERE exemption.brief_date = ?
        ORDER BY exemption.thesis_id`,
    ).bind(briefDate);
  }

  private async findAttemptByFreezeKey(freezeKey: string): Promise<DailyBriefResult | null> {
    const result = await this.readAttempt(`attempt.freeze_key = ?`, [freezeKey]);
    if (result !== null && result.freezeKey !== freezeKey) throw databaseError();
    return result;
  }

  private async findLatestAttempt(briefDate: string): Promise<DailyBriefResult | null> {
    const result = await this.readAttempt(
      `attempt.brief_date = ? ORDER BY attempt.created_at DESC, attempt.rowid DESC`,
      [briefDate],
    );
    if (result !== null && result.briefDate !== briefDate) throw databaseError();
    return result;
  }

  private async readAttempt(where: string, values: readonly unknown[]): Promise<DailyBriefResult | null> {
    const results = await this.database.batch<Record<string, unknown>>([
      this.database.prepare(
        `SELECT attempt.id, attempt.brief_date, attempt.freeze_key, attempt.outcome,
                attempt.data_cutoff, attempt.headline, attempt.summary, attempt.top_changes_json,
                attempt.target_snapshot_json, attempt.methodology_snapshot_json,
                attempt.rule_snapshot_json, attempt.source_health_snapshot_json,
                attempt.actor, attempt.created_at
           FROM daily_brief_attempts attempt
          WHERE ${where}
          LIMIT 1`,
      ).bind(...values),
    ]);
    if (!Array.isArray(results) || results.length !== 1) throw databaseError();
    const rows = queryRows(results[0]);
    if (rows.length === 0) return null;
    if (rows.length !== 1) throw databaseError();
    const attempt = decodeAttempt(rows[0]!);
    const gateResult = await this.database.batch<Record<string, unknown>>([
      this.database.prepare(
        `SELECT attempt_id, gate_code, status, explanation, reasons_json
           FROM daily_brief_gate_results WHERE attempt_id = ? ORDER BY gate_code`,
      ).bind(attempt.attemptId),
    ]);
    if (!Array.isArray(gateResult) || gateResult.length !== 1) throw databaseError();
    const gates = decodeGates(queryRows(gateResult[0]), attempt.attemptId);
    if (attempt.status === "published") {
      const published = await this.findPublished(attempt.briefDate);
      if (published === null || published.freezeKey !== attempt.freezeKey) throw databaseError();
      return published;
    }
    return deepFreeze({ ...attempt, gates });
  }
}

function decodeVersionFact(
  row: Record<string, unknown>,
  targets: readonly DailyBriefVersionTarget[],
  cutoff: string,
  citations: ReadonlyMap<string, readonly string[]>,
  previous: ReadonlyMap<string, DailyBriefFrozenVersionFact["previousPublished"]>,
  reviews: ReadonlyMap<string, { readonly thesisId: string; readonly beforeVersionId: string; readonly approved: boolean }>,
): DailyBriefFrozenVersionFact {
  const item = exactRecord(row, [
    "id", "thesis_id", "version", "status", "direction", "stage", "confidence",
    "based_on_cutoff", "calculation_json", "latest_version",
  ]);
  const id = nonEmptyString(item.id);
  const thesisId = requiredThesisId(item.thesis_id);
  if (!targets.some((target) => target.thesisId === thesisId && target.thesisVersionId === id)) {
    throw databaseError();
  }
  const calculation = jsonObject(item.calculation_json);
  const calculationThesisId = nullableString(calculation.thesisId) ?? "";
  const calculationCutoff = nullableString(calculation.cutoff) ?? "";
  const methodologyVersion = nullableString(calculation.methodologyVersion);
  const ruleVersion = nullableString(calculation.schemaVersion);
  const prior = previous.get(thesisId) ?? null;
  const review = reviews.get(id);
  const transitionReviewed = prior !== null
    && review !== undefined
    && review.thesisId === thesisId
    && review.beforeVersionId === prior.thesisVersionId
    && review.approved;
  const version = integer(item.version, 1);
  return {
    thesisId,
    thesisVersionId: id,
    version,
    status: enumValue(item.status, ["draft", "published", "withdrawn"] as const),
    isLatest: integer(item.latest_version, 1) === version,
    basedOnCutoff: canonicalUtc(item.based_on_cutoff),
    calculationThesisId,
    calculationCutoff,
    methodologyVersion,
    ruleVersion,
    citations: citations.get(id) ?? [],
    direction: enumValue(item.direction, THESIS_DIRECTIONS),
    stage: enumValue(item.stage, THESIS_STAGES),
    confidence: integer(item.confidence, 0, 100),
    previousPublished: prior,
    transitionReviewed,
  };
}

function decodeVersionGuard(row: Record<string, unknown>): VersionGuard {
  const item = exactRecord(row, [
    "id", "thesis_id", "version", "status", "direction", "stage", "confidence",
    "based_on_cutoff", "calculation_json", "latest_version",
  ]);
  return {
    id: nonEmptyString(item.id),
    thesisId: nonEmptyString(item.thesis_id),
    version: integer(item.version, 1),
    status: enumValue(item.status, ["draft", "published", "withdrawn"] as const),
    direction: enumValue(item.direction, THESIS_DIRECTIONS),
    stage: enumValue(item.stage, THESIS_STAGES),
    confidence: integer(item.confidence, 0, 100),
    basedOnCutoff: canonicalUtc(item.based_on_cutoff),
    calculationJson: nonEmptyString(item.calculation_json),
  };
}

function decodeEvidenceGuard(row: Record<string, unknown>): EvidenceGuard {
  const item = exactRecord(row, ["id", "thesis_version_id", "citation_url", "sort_order"]);
  return {
    id: nonEmptyString(item.id),
    versionId: nonEmptyString(item.thesis_version_id),
    citationUrl: typeof item.citation_url === "string" ? item.citation_url : "",
    sortOrder: integer(item.sort_order, 0),
  };
}

function decodeSourceGuard(row: Record<string, unknown>): SourceGuard {
  const item = exactRecord(row, [
    "id", "last_success_at", "late_after_minutes", "stale_after_minutes",
    "consecutive_failures", "last_error_code", "ambiguous_retry_rewrites",
  ]);
  const lastErrorCode = item.last_error_code === null
    ? null
    : enumValue(item.last_error_code, SOURCE_ERROR_CODES);
  return {
    id: nonEmptyString(item.id),
    lastSuccessAt: nullableCanonicalUtc(item.last_success_at),
    lateAfterMinutes: integer(item.late_after_minutes, 0),
    staleAfterMinutes: integer(item.stale_after_minutes, 0),
    consecutiveFailures: integer(item.consecutive_failures, 0),
    lastErrorCode,
    ambiguousRetryRewrites: integer(item.ambiguous_retry_rewrites, 0),
  };
}

function decodeCitations(
  rows: readonly Record<string, unknown>[],
  allowedVersionIds: ReadonlySet<string>,
): ReadonlyMap<string, readonly string[]> {
  const values = new Map<string, string[]>();
  const orders = new Map<string, Set<number>>();
  for (const row of rows) {
    const item = exactRecord(row, ["id", "thesis_version_id", "citation_url", "sort_order"]);
    const versionId = nonEmptyString(item.thesis_version_id);
    if (!allowedVersionIds.has(versionId)) throw databaseError();
    const sortOrder = integer(item.sort_order, 0);
    const used = orders.get(versionId) ?? new Set<number>();
    if (used.has(sortOrder)) throw databaseError();
    used.add(sortOrder);
    orders.set(versionId, used);
    const citations = values.get(versionId) ?? [];
    citations.push(typeof item.citation_url === "string" ? item.citation_url : "");
    values.set(versionId, citations);
  }
  return values;
}

function decodePrevious(
  rows: readonly Record<string, unknown>[],
  exemptions: readonly DailyBriefExemption[],
): ReadonlyMap<string, NonNullable<DailyBriefFrozenVersionFact["previousPublished"]>> {
  if (rows.length + exemptions.length !== 0 && rows.length + exemptions.length !== REQUIRED_DAILY_THESIS_IDS.length) {
    throw databaseError();
  }
  const exemptedTheses = new Set<string>(exemptions.map((exemption) => exemption.thesisId));
  const values = new Map<string, NonNullable<DailyBriefFrozenVersionFact["previousPublished"]>>();
  const dates = new Set<string>();
  for (const row of rows) {
    const item = exactRecord(row, [
      "brief_date", "thesis_id", "thesis_version_id", "direction", "stage", "confidence",
    ]);
    dates.add(calendarDate(item.brief_date));
    const thesisId = requiredThesisId(item.thesis_id);
    if (values.has(thesisId) || exemptedTheses.has(thesisId)) throw databaseError();
    values.set(thesisId, {
      thesisVersionId: nonEmptyString(item.thesis_version_id),
      direction: enumValue(item.direction, THESIS_DIRECTIONS),
      stage: enumValue(item.stage, THESIS_STAGES),
      confidence: integer(item.confidence, 0, 100),
    });
  }
  if (
    dates.size > 1
    || (rows.length + exemptions.length > 0
      && REQUIRED_DAILY_THESIS_IDS.some((thesisId) => !values.has(thesisId) && !exemptedTheses.has(thesisId)))
  ) throw databaseError();
  return values;
}

function decodePreviousGuard(row: Record<string, unknown>): PreviousBriefGuard {
  const item = exactRecord(row, [
    "brief_date", "thesis_id", "thesis_version_id", "direction", "stage", "confidence",
  ]);
  return {
    briefDate: calendarDate(item.brief_date),
    thesisId: requiredThesisId(item.thesis_id),
    thesisVersionId: nonEmptyString(item.thesis_version_id),
    direction: enumValue(item.direction, THESIS_DIRECTIONS),
    stage: enumValue(item.stage, THESIS_STAGES),
    confidence: integer(item.confidence, 0, 100),
  };
}

/** Empty result means "no obligation": no baseline, already exactly reviewed, or no trigger. */
function decodePendingReviewObligation(row: Record<string, unknown>): PendingReviewObligation[] {
  const item = exactRecord(row, [
    "thesis_id", "thesis_version_id", "direction", "stage", "confidence",
    "before_version_id", "prior_direction", "prior_stage", "prior_confidence",
    "matched_review_status",
  ]);
  if (item.before_version_id === null || item.prior_direction === null) return [];
  if (item.matched_review_status === "approved") return [];
  const triggers = highRiskTriggers({
    direction: enumValue(item.direction, THESIS_DIRECTIONS),
    stage: enumValue(item.stage, THESIS_STAGES),
    confidence: integer(item.confidence, 0, 100),
    previousPublished: {
      direction: enumValue(item.prior_direction, THESIS_DIRECTIONS),
      stage: enumValue(item.prior_stage, THESIS_STAGES),
      confidence: integer(item.prior_confidence, 0, 100),
    },
  });
  if (triggers.length === 0) return [];
  return [{
    thesisId: requiredThesisId(item.thesis_id),
    afterVersionId: nonEmptyString(item.thesis_version_id),
    beforeVersionId: nonEmptyString(item.before_version_id),
    triggers: [...triggers].sort(),
  }];
}

function decodeReviews(
  rows: readonly Record<string, unknown>[],
  allowedAfterIds: ReadonlySet<string>,
  occurredAt: string,
): ReadonlyMap<string, {
  readonly thesisId: string;
  readonly beforeVersionId: string;
  readonly approved: boolean;
}> {
  const values = new Map<string, { thesisId: string; beforeVersionId: string; approved: boolean }>();
  for (const row of rows) {
    const item = exactRecord(row, [
      "thesis_id", "before_version_id", "after_version_id", "status",
      "reviewed_by", "reviewed_at", "reason",
    ]);
    const afterVersionId = nonEmptyString(item.after_version_id);
    if (!allowedAfterIds.has(afterVersionId) || values.has(afterVersionId)) throw databaseError();
    const status = enumValue(item.status, ["pending", "approved", "rejected"] as const);
    const reviewedBy = nullableString(item.reviewed_by);
    const reviewedAt = nullableCanonicalUtc(item.reviewed_at);
    const reason = nullableString(item.reason);
    if (status === "approved" && (reviewedBy === null || reviewedAt === null || reason === null)) {
      throw databaseError();
    }
    if (reviewedAt !== null && new Date(reviewedAt).valueOf() > new Date(occurredAt).valueOf()) {
      throw databaseError();
    }
    values.set(afterVersionId, {
      thesisId: nonEmptyString(item.thesis_id),
      beforeVersionId: nonEmptyString(item.before_version_id),
      approved: status === "approved",
    });
  }
  return values;
}

function decodeReviewGuard(row: Record<string, unknown>): ReviewGuard {
  const item = exactRecord(row, [
    "thesis_id", "before_version_id", "after_version_id", "status",
    "reviewed_by", "reviewed_at", "reason",
  ]);
  return {
    thesisId: nonEmptyString(item.thesis_id),
    beforeVersionId: nonEmptyString(item.before_version_id),
    afterVersionId: nonEmptyString(item.after_version_id),
    status: enumValue(item.status, ["pending", "approved", "rejected"] as const),
    reviewedBy: nullableString(item.reviewed_by),
    reviewedAt: nullableCanonicalUtc(item.reviewed_at),
    reason: nullableString(item.reason),
  };
}

function decodeSourceHealth(
  row: Record<string, unknown>,
  cutoff: string,
): DailyBriefSourceHealthSnapshot {
  const item = exactRecord(row, [
    "id", "last_success_at", "late_after_minutes", "stale_after_minutes",
    "consecutive_failures", "last_error_code", "ambiguous_retry_rewrites",
  ]);
  if (integer(item.ambiguous_retry_rewrites, 0) > 0) throw databaseError();
  const lastError = item.last_error_code === null
    ? null
    : enumValue(item.last_error_code, SOURCE_ERROR_CODES);
  const health = calculateSourceHealth({
    sourceId: nonEmptyString(item.id),
    checkedAt: cutoff,
    lastSuccessAt: nullableCanonicalUtc(item.last_success_at),
    lateAfterMinutes: integer(item.late_after_minutes, 0),
    staleAfterMinutes: integer(item.stale_after_minutes, 0),
    consecutiveFailures: integer(item.consecutive_failures, 0),
    lastErrorCode: lastError,
  });
  return health;
}

function frozenVersionsFromFacts(
  facts: readonly DailyBriefFrozenVersionFact[],
): readonly FrozenDailyBriefVersion[] {
  const byThesis = new Map(facts.map((fact) => [fact.thesisId, fact]));
  return deepFreeze(REQUIRED_DAILY_THESIS_IDS.flatMap((thesisId, sortOrder) => {
    const fact = byThesis.get(thesisId);
    if (fact?.methodologyVersion === null || fact?.methodologyVersion === undefined) return [];
    if (fact.ruleVersion === null) return [];
    return [{
      thesisId,
      thesisVersionId: fact.thesisVersionId,
      version: fact.version,
      methodologyVersion: fact.methodologyVersion,
      ruleVersion: fact.ruleVersion,
      sortOrder,
    }];
  }));
}

function decodePublishedResult(
  briefRow: Record<string, unknown>,
  linkRows: readonly Record<string, unknown>[],
  attemptRow: Record<string, unknown>,
  gateRows: readonly Record<string, unknown>[],
  exemptions: readonly DailyBriefExemption[],
): DailyBriefResult {
  const brief = exactRecord(briefRow, [
    "brief_date", "status", "freeze_key", "headline", "summary", "top_changes_json",
    "data_cutoff", "methodology_snapshot_json", "rule_snapshot_json",
    "source_health_snapshot_json", "publication_attempt_id", "published_at", "published_by",
  ]);
  if (brief.status !== "published") throw databaseError();
  const attempt = decodeAttempt(attemptRow);
  if (attempt.status !== "published") throw databaseError();
  const briefDate = calendarDate(brief.brief_date);
  const freezeKey = nonEmptyString(brief.freeze_key);
  const attemptId = nonEmptyString(brief.publication_attempt_id);
  if (
    attempt.briefDate !== briefDate
    || attempt.freezeKey !== freezeKey
    || attempt.attemptId !== attemptId
    || attempt.cutoff !== canonicalUtc(brief.data_cutoff)
    || attempt.headline !== nonEmptyString(brief.headline)
    || attempt.summary !== nonEmptyString(brief.summary)
  ) throw databaseError();
  const versions = decodeFrozenLinks(
    linkRows,
    briefDate,
    attempt.cutoff,
    freezeKey.startsWith(LEGACY_DAILY_BRIEF_FREEZE_PREFIX),
    new Set(exemptions.map((exemption) => exemption.thesisId)),
  );
  const methodologySnapshot = jsonArray(brief.methodology_snapshot_json);
  const ruleSnapshot = jsonArray(brief.rule_snapshot_json);
  if (
    canonicalJsonSafe(methodologySnapshot) !== canonicalJsonSafe(versions.map(({ thesisId, methodologyVersion }) => ({ thesisId, methodologyVersion })))
    || canonicalJsonSafe(ruleSnapshot) !== canonicalJsonSafe(versions.map(({ thesisId, ruleVersion }) => ({ thesisId, ruleVersion })))
    || canonicalJsonSafe(jsonArray(brief.source_health_snapshot_json)) !== canonicalJsonSafe(attempt.sourceHealth)
    || canonicalJsonSafe(jsonArray(brief.top_changes_json)) !== canonicalJsonSafe(attempt.topChanges)
  ) throw databaseError();
  const gates = decodeGates(gateRows, attemptId);
  if (gates.some((gate) => gate.status !== "passed")) throw databaseError();
  return deepFreeze({
    ...attempt,
    status: "published",
    versions,
    exemptions,
    gates,
    publishedAt: canonicalUtc(brief.published_at),
    publishedBy: nonEmptyString(brief.published_by),
  });
}

function decodeAttempt(row: Record<string, unknown>): DailyBriefResult {
  const allowed = [
    "id", "brief_date", "freeze_key", "outcome", "data_cutoff", "headline", "summary",
    "top_changes_json", "target_snapshot_json", "methodology_snapshot_json",
    "rule_snapshot_json", "source_health_snapshot_json", "actor", "created_at",
  ];
  const publishedAllowed = allowed.filter((key) => ![
    "target_snapshot_json", "methodology_snapshot_json", "rule_snapshot_json",
  ].includes(key));
  const item = exactRecord(row, Object.keys(row).includes("target_snapshot_json") ? allowed : publishedAllowed);
  const status = enumValue(item.outcome, ["published", "delayed"] as const);
  const sourceHealth = decodeSourceSnapshotJson(item.source_health_snapshot_json, canonicalUtc(item.data_cutoff));
  const versions = "target_snapshot_json" in item
    ? decodeAttemptVersions(item.target_snapshot_json, item.methodology_snapshot_json, item.rule_snapshot_json)
    : [];
  return deepFreeze({
    briefDate: calendarDate(item.brief_date),
    status,
    freezeKey: nonEmptyString(item.freeze_key),
    cutoff: canonicalUtc(item.data_cutoff),
    headline: nonEmptyString(item.headline),
    summary: nonEmptyString(item.summary),
    topChanges: stringArray(item.top_changes_json),
    gates: [],
    sourceHealth,
    versions,
    exemptions: [],
    publishedAt: status === "published" ? canonicalUtc(item.created_at) : null,
    publishedBy: status === "published" ? nonEmptyString(item.actor) : null,
    attemptId: nonEmptyString(item.id),
  });
}

function decodeAttemptVersions(targetJson: unknown, methodologyJson: unknown, ruleJson: unknown): readonly FrozenDailyBriefVersion[] {
  const targets = jsonArray(targetJson);
  const methodologies = jsonArray(methodologyJson);
  const rules = jsonArray(ruleJson);
  if (
    targets.length < 1
    || targets.length > REQUIRED_DAILY_THESIS_IDS.length
    || methodologies.length !== targets.length
    || rules.length !== targets.length
  ) throw databaseError();
  const seenSortOrders = new Set<number>();
  return deepFreeze(targets.map((raw, index) => {
    const target = exactRecord(raw, ["thesisId", "thesisVersionId", "version", "sortOrder"]);
    const method = exactRecord(methodologies[index], ["thesisId", "methodologyVersion"]);
    const rule = exactRecord(rules[index], ["thesisId", "ruleVersion"]);
    const thesisId = requiredThesisId(target.thesisId);
    const sortOrder = integer(target.sortOrder, 0, 5);
    if (
      method.thesisId !== thesisId
      || rule.thesisId !== thesisId
      || REQUIRED_DAILY_THESIS_IDS[sortOrder] !== thesisId
      || seenSortOrders.has(sortOrder)
    ) throw databaseError();
    seenSortOrders.add(sortOrder);
    return {
      thesisId,
      thesisVersionId: nonEmptyString(target.thesisVersionId),
      version: integer(target.version, 1),
      methodologyVersion: nonEmptyString(method.methodologyVersion),
      ruleVersion: nonEmptyString(rule.ruleVersion),
      sortOrder,
    };
  }));
}

function decodeFrozenLinks(
  rows: readonly Record<string, unknown>[],
  briefDate: string,
  cutoff: string,
  legacyCompatible: boolean,
  exemptedTheses: ReadonlySet<string>,
): readonly FrozenDailyBriefVersion[] {
  if (rows.length + exemptedTheses.size !== REQUIRED_DAILY_THESIS_IDS.length) throw databaseError();
  const seenSortOrders = new Set<number>();
  return deepFreeze(rows.map((row) => {
    const item = exactRecord(row, [
      "brief_date", "thesis_id", "thesis_version_id", "methodology_version", "rule_version",
      "sort_order", "version", "status", "based_on_cutoff", "calculation_json",
    ]);
    const thesisId = requiredThesisId(item.thesis_id);
    const calculation = jsonObject(item.calculation_json);
    const methodologyVersion = nonEmptyString(item.methodology_version);
    const ruleVersion = nonEmptyString(item.rule_version);
    const status = enumValue(item.status, ["published", "withdrawn"] as const);
    const sortOrder = integer(item.sort_order, 0, 5);
    if (
      item.brief_date !== briefDate
      || (status !== "published" && status !== "withdrawn")
      || REQUIRED_DAILY_THESIS_IDS[sortOrder] !== thesisId
      || seenSortOrders.has(sortOrder)
      || exemptedTheses.has(thesisId)
      || (!legacyCompatible && canonicalUtc(item.based_on_cutoff) !== cutoff)
      || (!legacyCompatible && calculation.thesisId !== thesisId)
      || (!legacyCompatible && calculation.cutoff !== cutoff)
      || (!legacyCompatible && calculation.methodologyVersion !== methodologyVersion)
      || (!legacyCompatible && calculation.schemaVersion !== ruleVersion)
    ) throw databaseError();
    seenSortOrders.add(sortOrder);
    return {
      thesisId,
      thesisVersionId: nonEmptyString(item.thesis_version_id),
      version: integer(item.version, 1),
      methodologyVersion,
      ruleVersion,
      sortOrder,
    };
  }));
}

/** One acknowledged coverage gap per exempted thesis; the gap itself must be a real seed gap id. */
function decodeExemptions(rows: readonly Record<string, unknown>[]): readonly DailyBriefExemption[] {
  if (rows.length > REQUIRED_DAILY_THESIS_IDS.length) throw databaseError();
  const seen = new Set<string>();
  return deepFreeze(rows.map((row) => {
    const item = exactRecord(row, ["thesis_id", "gap_id"]);
    const thesisId = requiredThesisId(item.thesis_id);
    if (seen.has(thesisId)) throw databaseError();
    seen.add(thesisId);
    return { thesisId, gapId: nonEmptyString(item.gap_id) };
  }));
}

function decodeSourceSnapshotJson(value: unknown, cutoff: string): readonly DailyBriefSourceHealthSnapshot[] {
  const rows = jsonArray(value);
  const seen = new Set<string>();
  return deepFreeze(rows.map((raw) => {
    const item = exactRecord(raw, ["sourceId", "status", "checkedAt", "lastSuccessAt", "consecutiveFailures"]);
    const sourceId = nonEmptyString(item.sourceId);
    if (seen.has(sourceId) || item.checkedAt !== cutoff) throw databaseError();
    seen.add(sourceId);
    return {
      sourceId,
      status: enumValue(item.status, ["healthy", "delayed", "stale", "broken"] as const),
      checkedAt: canonicalUtc(item.checkedAt),
      lastSuccessAt: nullableCanonicalUtc(item.lastSuccessAt),
      consecutiveFailures: integer(item.consecutiveFailures, 0),
    };
  }));
}

function decodeGates(rows: readonly Record<string, unknown>[], attemptId: string): readonly DailyBriefGateResult[] {
  if (rows.length !== DAILY_BRIEF_GATE_CODES.length) throw databaseError();
  const byCode = new Map<string, DailyBriefGateResult>();
  for (const row of rows) {
    const item = exactRecord(row, ["attempt_id", "gate_code", "status", "explanation", "reasons_json"]);
    if (item.attempt_id !== attemptId) throw databaseError();
    const code = enumValue(item.gate_code, DAILY_BRIEF_GATE_CODES);
    if (byCode.has(code)) throw databaseError();
    byCode.set(code, {
      code,
      status: enumValue(item.status, ["passed", "failed"] as const),
      explanation: nonEmptyString(item.explanation),
      reasons: stringArray(item.reasons_json),
    });
  }
  return deepFreeze(DAILY_BRIEF_GATE_CODES.map((code) => {
    const gate = byCode.get(code);
    if (gate === undefined) throw databaseError();
    return gate;
  }));
}

function assertMutation(mutation: DailyBriefMutation): void {
  if (typeof mutation !== "object" || mutation === null || !Array.isArray(mutation.targets)) {
    throw new DailyBriefError("VALIDATION", "每日判定存储命令无效");
  }
  calendarDate(mutation.briefDate);
  canonicalUtc(mutation.cutoff);
  canonicalUtc(mutation.occurredAt);
  nonEmptyString(mutation.attemptId);
  nonEmptyString(mutation.auditId);
  if (
    !Array.isArray(mutation.exemptions)
    || mutation.targets.length < 1
    || mutation.targets.length + mutation.exemptions.length !== REQUIRED_DAILY_THESIS_IDS.length
  ) {
    throw new DailyBriefError("VALIDATION", "每日判定存储目标不完整");
  }
}

/** Returns the write-failure error when it carries a stable stage label, else null. */
function guardedStageError(error: unknown): DailyBriefError | null {
  if (!(error instanceof DailyBriefError)) return null;
  const stage = error.details?.stage;
  return typeof stage === "string" && stage.length > 0 ? error : null;
}

function assertWriteBatch(results: unknown, stages: readonly string[]): void {
  if (!Array.isArray(results) || results.length !== stages.length) throw databaseError();
  for (const [index, result] of results.entries()) {
    const stage = stages[index] ?? `statement-${index}`;
    const item = recordValue(result);
    if (item.success !== true) throw databaseError({ stage });
    const meta = recordValue(item.meta);
    if (integer(meta.changes, 0) !== 1) throw databaseError({ stage });
  }
}

function queryRows(result: unknown): Record<string, unknown>[] {
  const item = recordValue(result);
  if (item.success !== true || !Array.isArray(item.results)) throw databaseError();
  return item.results.map(recordValue);
}

function exactRecord(value: unknown, keys: readonly string[]): Record<string, unknown> {
  const item = recordValue(value);
  const expected = new Set(keys);
  if (Object.keys(item).length !== keys.length || Object.keys(item).some((key) => !expected.has(key))) {
    throw databaseError();
  }
  return item;
}

function recordValue(value: unknown): Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) throw databaseError();
  return value as Record<string, unknown>;
}

function jsonObject(value: unknown): Record<string, unknown> {
  if (typeof value !== "string") throw databaseError();
  try {
    return recordValue(JSON.parse(value) as unknown);
  } catch {
    throw databaseError();
  }
}

function jsonArray(value: unknown): unknown[] {
  if (typeof value !== "string") throw databaseError();
  try {
    const parsed = JSON.parse(value) as unknown;
    if (!Array.isArray(parsed)) throw databaseError();
    return parsed;
  } catch {
    throw databaseError();
  }
}

function stringArray(value: unknown): readonly string[] {
  const parsed = jsonArray(value);
  if (parsed.some((item) => typeof item !== "string")) throw databaseError();
  return parsed as string[];
}

function canonicalJsonSafe(value: unknown): string {
  try {
    return JSON.stringify(value);
  } catch {
    throw databaseError();
  }
}

function integer(value: unknown, minimum: number, maximum = Number.MAX_SAFE_INTEGER): number {
  if (!Number.isInteger(value) || (value as number) < minimum || (value as number) > maximum) {
    throw databaseError();
  }
  return value as number;
}

function nonEmptyString(value: unknown): string {
  if (typeof value !== "string" || value.trim().length === 0) throw databaseError();
  return value;
}

function nullableString(value: unknown): string | null {
  if (value === null) return null;
  if (typeof value !== "string" || value.trim().length === 0) return null;
  return value;
}

function canonicalUtc(value: unknown): string {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(value)) {
    throw databaseError();
  }
  const parsed = new Date(value);
  if (Number.isNaN(parsed.valueOf()) || parsed.toISOString() !== value) throw databaseError();
  return value;
}

function nullableCanonicalUtc(value: unknown): string | null {
  if (value === null) return null;
  return canonicalUtc(value);
}

function calendarDate(value: unknown): string {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)) throw databaseError();
  const parsed = new Date(`${value}T00:00:00.000Z`);
  if (Number.isNaN(parsed.valueOf()) || parsed.toISOString().slice(0, 10) !== value) throw databaseError();
  return value;
}

function requiredThesisId(value: unknown): RequiredDailyThesisId {
  if (typeof value !== "string" || !REQUIRED_DAILY_THESIS_IDS.includes(value as RequiredDailyThesisId)) {
    throw databaseError();
  }
  return value as RequiredDailyThesisId;
}

function enumValue<const T extends readonly string[]>(value: unknown, values: T): T[number] {
  if (typeof value !== "string" || !values.includes(value)) throw databaseError();
  return value as T[number];
}

function conflict(expectedFreezeKey: string | null, currentFreezeKey: string | null): DailyBriefError {
  return new DailyBriefError(
    "VERSION_CONFLICT",
    "每日判定冻结版本发生并发冲突",
    { expectedFreezeKey, currentFreezeKey },
  );
}

function databaseError(details: Readonly<Record<string, unknown>> | null = null): DailyBriefError {
  return new DailyBriefError("DATABASE", "D1 无法完成或读取每日判定冻结", details);
}

function deepFreeze<T>(value: T): T {
  if (typeof value !== "object" || value === null || Object.isFrozen(value)) return value;
  for (const child of Object.values(value)) deepFreeze(child);
  return Object.freeze(value);
}
