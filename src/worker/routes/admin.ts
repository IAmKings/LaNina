import {
  REQUIRED_DAILY_THESIS_IDS,
  shanghaiBriefDate,
  type DailyBriefExemption,
  type DailyBriefFreezeCommand,
  type DailyBriefResult,
} from "../../domain/daily-brief";
import { coverageGapOf } from "../../domain/coverage-gaps";
import type {
  AdminDraftPageModel,
  AdminRole,
  AdminRunsPageModel,
} from "../../domain/page-models";
import type {
  ThesisPublicationAction,
  ThesisPublicationCommand,
  ThesisPublicationTransition,
} from "../../domain/thesis-publication";
import type { AdminDailyBriefRead } from "../context";
import { AppContext } from "../context";
import {
  AdministrativeBodyTooLargeError,
  administrativeBodyTooLargeResponse,
  parseAdministrativeDailyPublicationBody,
  parseAdministrativeDraftEditBody,
  parseAdministrativeThesisEvaluateBody,
  parseAdministrativeThesisPublicationBody,
  parseAdministrativeThesisReviewBody,
  parseIdempotencyKey,
  parseManualSourceRunBody,
  type AdministrativeDailyPublicationBody,
  type AdministrativeDraftEditBody,
  type AdministrativeThesisEvaluateBody,
  type AdministrativeThesisPublicationBody,
  type AdministrativeThesisReviewBody,
} from "../http/body";
import { json, pageMeta } from "../http/envelope";
import {
  ADMIN_AUTHORIZATION_ERRORS,
  ADMINISTRATIVE_DRAFT_EDIT_ERRORS,
  DAILY_BRIEF_PUBLICATION_ERRORS,
  MANUAL_SOURCE_RUN_ERRORS,
  THESIS_CHANGE_REVIEW_ERRORS,
  THESIS_EVALUATION_ERRORS,
  THESIS_PUBLICATION_ERRORS,
  logPublicRouteError,
  mapModuleError,
} from "../http/errors";
import type { RouteContext } from "../http/router";
import { AccessJwtError, authenticateAccessRequest, hasAtLeastAdminRole, type AccessActor } from "../modules/access-auth";
import { isAdminThesisId, parseAdminRunsCursor, type AdminRunsCursor } from "../modules/admin-read-models";
import { DailyBriefError } from "../modules/daily-briefs";
import { isPublicDailyBriefDate } from "../modules/public-daily-briefs";
import type { DailyPublicationTargetResolution } from "../modules/daily-publication";
import { MANUAL_CHANGE_REASON } from "../modules/thesis-evaluation";
import type {
  ThesisChangeReviewCommand,
  ThesisChangeReviewDecision,
  ThesisChangeReviewRecord,
} from "../modules/thesis-change-reviews";
import type { AdministrativeDraftEditCommand, AdministrativeDraftEditResult } from "../modules/thesis-drafts";
import type { ThesisEvaluationCommand, ThesisEvaluationResult } from "../modules/thesis-evaluation";
import type { ManualSourceRunInput, ManualSourceRunResult } from "../modules/manual-source-runs";

/**
 * The ten administrative routes. withAdmin encodes the shared skeleton — authenticate against
 * Cloudflare Access with a minimum role, then hand the verified actor to the route — while each
 * route keeps its own param/body validation order and module error table.
 */

/** 版本 ID 的字符集/长度约束（原 administrativeDraftVersionIdFromPath 等提取正则）。 */
const THESIS_VERSION_ID = /^[A-Za-z0-9_-]{1,128}$/;

function thesisVersionIdOrNull(versionId: string): string | null {
  return THESIS_VERSION_ID.test(versionId) ? versionId : null;
}

async function authorizeAdminFromAccess(request: Request, minimumRole: AdminRole, env: RouteContext["env"]): Promise<AccessActor> {
  // 与 authorizeAccessRequest 相同的语义，但 role-map 配置经 AppContext 按环境解析一次，
  // 不再每个请求重复 JSON.parse；JWKS 缓存仍留在 access-auth 模块级。
  const actor = await authenticateAccessRequest(request, AppContext.from(env).accessConfiguration());
  if (!hasAtLeastAdminRole(actor, minimumRole)) throw new AccessJwtError("AUTH_FORBIDDEN");
  return actor;
}

async function withAdmin(
  ctx: RouteContext,
  minimumRole: AdminRole,
  run: (actor: AccessActor) => Response | Promise<Response>,
): Promise<Response> {
  let actor: AccessActor;
  try {
    actor = await (ctx.dependencies.authorizeAdmin ?? authorizeAdminFromAccess)(ctx.request, minimumRole, ctx.env);
  } catch (error) {
    return mapModuleError(error, ctx.requestId, ADMIN_AUTHORIZATION_ERRORS);
  }
  return run(actor);
}

function adminActor(actor: AccessActor): AdminRunsPageModel["actor"] {
  return {
    email: actor.email ?? "已验证成员",
    roles: actor.roles,
  };
}

/**
 * Read-only views may show a generic verified-member label, but an append-only
 * audit entry must identify the actual Access member who initiated a write.
 */
function administrativeActor(actor: AccessActor): string {
  if (actor.email === null) throw new AccessJwtError("AUTH_FORBIDDEN");
  return actor.email;
}

function administrativeActorOrError(actor: AccessActor, requestId: string): string | Response {
  try {
    return administrativeActor(actor);
  } catch (error) {
    return mapModuleError(error, requestId, ADMIN_AUTHORIZATION_ERRORS);
  }
}

async function adminRunsFromCloudflareBindings(
  actor: AdminRunsPageModel["actor"],
  cursor: AdminRunsCursor | null,
  env: RouteContext["env"],
): Promise<AdminRunsPageModel> {
  return AppContext.from(env).adminReadModel().runs(actor, cursor);
}

async function adminDraftFromCloudflareBindings(
  actor: AdminDraftPageModel["actor"],
  thesisId: string,
  env: RouteContext["env"],
): Promise<AdminDraftPageModel | null> {
  return AppContext.from(env).adminReadModel().draft(actor, thesisId);
}

async function manualSourceRunFromCloudflareBindings(
  input: ManualSourceRunInput,
  env: RouteContext["env"],
): Promise<ManualSourceRunResult> {
  return AppContext.from(env).manualSourceRuns().run(input);
}

async function administrativeDraftEditFromCloudflareBindings(
  input: AdministrativeDraftEditCommand,
  env: RouteContext["env"],
): Promise<AdministrativeDraftEditResult> {
  return AppContext.from(env).thesisDrafts().editAdministrative(input);
}

async function thesisPublicationFromCloudflareBindings(
  action: ThesisPublicationAction,
  input: ThesisPublicationCommand,
  env: RouteContext["env"],
): Promise<ThesisPublicationTransition> {
  const publication = AppContext.from(env).thesisPublications();
  return action === "publish" ? publication.publish(input) : publication.withdraw(input);
}

async function thesisChangeReviewFromCloudflareBindings(
  input: ThesisChangeReviewCommand,
  env: RouteContext["env"],
): Promise<ThesisChangeReviewRecord> {
  return AppContext.from(env).thesisChangeReviews().record(input);
}

async function thesisEvaluationFromCloudflareBindings(
  input: ThesisEvaluationCommand,
  env: RouteContext["env"],
): Promise<ThesisEvaluationResult> {
  return AppContext.from(env).thesisEvaluations().evaluate(input);
}

async function dailyPublicationTargetsFromCloudflareBindings(
  cutoff: string,
  env: RouteContext["env"],
): Promise<DailyPublicationTargetResolution> {
  return AppContext.from(env).dailyPublicationTargets().resolve(cutoff);
}

async function dailyBriefFreezeFromCloudflareBindings(
  command: DailyBriefFreezeCommand,
  env: RouteContext["env"],
): Promise<DailyBriefResult> {
  return AppContext.from(env).dailyBriefs().freezeAndPublish(command);
}

/**
 * The 06:30 Asia/Shanghai evaluation runs at 22:30 UTC of the previous day. Deriving the cutoff
 * from the brief date keeps the administrative read and the publication command aligned, and the
 * round-trip check refuses any date the frozen date helper would not reproduce.
 */
function evaluationCutoffForBriefDate(briefDate: string): string {
  const cutoff = new Date(`${briefDate}T22:30:00.000Z`);
  cutoff.setUTCDate(cutoff.getUTCDate() - 1);
  const value = cutoff.toISOString();
  if (shanghaiBriefDate(value) !== briefDate) {
    throw new DailyBriefError("VALIDATION", "无法为该日期确定评估截止时间");
  }
  return value;
}

async function adminDailyBriefFromCloudflareBindings(
  briefDate: string,
  env: RouteContext["env"],
): Promise<AdminDailyBriefRead> {
  const cutoff = evaluationCutoffForBriefDate(briefDate);
  const app = AppContext.from(env);
  const repository = app.dailyBriefRepository();
  const briefs = app.dailyBriefs();
  const [published, currentFreezeKey, targets] = await Promise.all([
    briefs.findPublished(briefDate),
    briefs.currentFreezeKey(briefDate),
    dailyPublicationTargetsFromCloudflareBindings(cutoff, env),
  ]);
  const pendingReviews = published !== null
    ? []
    : await repository.findPendingReviewObligations(
      briefDate,
      targets.resolvableTargets.map((target) => target.thesisVersionId),
    );
  return {
    briefDate,
    cutoff,
    published: published !== null,
    publishedAt: published?.publishedAt ?? null,
    currentFreezeKey,
    // 预检展示该 cutoff 的实际候选版本（可能是 draft）：一键发布需要论点与版本号才能携带
    // expectedVersion；冻结目标仍由服务端在发布时重新按已发布版本解析。
    targets: targets.candidateTargets.map((candidate) => ({
      thesisId: candidate.thesisId,
      thesisVersionId: candidate.thesisVersionId,
      version: candidate.version,
      status: candidate.status,
    })),
    blockers: targets.blockers,
    exemptibleTargets: targets.exemptibleTargets,
    pendingReviews: pendingReviews.map((obligation) => ({
      thesisId: obligation.thesisId,
      afterVersionId: obligation.afterVersionId,
      beforeVersionId: obligation.beforeVersionId,
      triggers: obligation.triggers,
    })),
  };
}

export function adminRunsRoute(_request: Request, ctx: RouteContext): Promise<Response> {
  return withAdmin(ctx, "viewer", async (actor) => {
    const rawCursor = ctx.url.searchParams.get("cursor");
    const cursor = parseAdminRunsCursor(rawCursor);
    if (rawCursor !== null && cursor === null) {
      return json({
        error: {
          code: "VALIDATION",
          message: "后台运行分页参数无效",
          requestId: ctx.requestId,
        },
      }, 400);
    }

    try {
      const runs = await (ctx.dependencies.adminRuns ?? adminRunsFromCloudflareBindings)(adminActor(actor), cursor, ctx.env);
      const generatedAt = ctx.nowIso();
      return json<AdminRunsPageModel>({
        data: runs,
        meta: pageMeta(generatedAt, generatedAt, "unavailable"),
      });
    } catch (error) {
      logPublicRouteError(ctx.requestId, ctx.url.pathname, error);
      return json({
        error: {
          code: "DATABASE",
          message: "后台运行记录暂不可用，请稍后重试",
          requestId: ctx.requestId,
        },
      }, 503);
    }
  });
}

export function adminDraftRoute(_request: Request, ctx: RouteContext): Promise<Response> {
  return withAdmin(ctx, "viewer", async (actor) => {
    const thesisId = ctx.params.thesisId;
    if (!isAdminThesisId(thesisId)) {
      return json({
        error: { code: "NOT_FOUND", message: "未找到可审核的论点", requestId: ctx.requestId },
      }, 404);
    }

    try {
      const draft = await (ctx.dependencies.adminDraft ?? adminDraftFromCloudflareBindings)(
        adminActor(actor),
        thesisId,
        ctx.env,
      );
      if (draft === null) {
        return json({
          error: { code: "NOT_FOUND", message: "未找到可审核的论点", requestId: ctx.requestId },
        }, 404);
      }
      const generatedAt = ctx.nowIso();
      const dataCutoff = draft.draft?.basedOnCutoff ?? draft.published?.basedOnCutoff ?? generatedAt;
      return json<AdminDraftPageModel>({
        data: draft,
        meta: pageMeta(generatedAt, dataCutoff, "unavailable"),
      });
    } catch (error) {
      logPublicRouteError(ctx.requestId, ctx.url.pathname, error);
      return json({
        error: {
          code: "DATABASE",
          message: "后台草稿审核暂不可用，请稍后重试",
          requestId: ctx.requestId,
        },
      }, 503);
    }
  });
}

export function administrativeDraftEditRoute(_request: Request, ctx: RouteContext): Promise<Response> {
  return withAdmin(ctx, "editor", async (actor) => {
    const versionId = thesisVersionIdOrNull(ctx.params.versionId);
    if (versionId === null) {
      return json({
        error: { code: "NOT_FOUND", message: "未找到可编辑论点草稿", requestId: ctx.requestId },
      }, 404);
    }

    let body: AdministrativeDraftEditBody | null;
    try {
      body = await parseAdministrativeDraftEditBody(ctx.request);
    } catch (error) {
      if (error instanceof AdministrativeBodyTooLargeError) {
        return administrativeBodyTooLargeResponse(ctx.requestId);
      }
      throw error;
    }
    if (body === null) {
      return json({
        error: { code: "VALIDATION", message: "草稿编辑请求无效", requestId: ctx.requestId },
      }, 400);
    }

    const occurredAt = ctx.nowIso();
    const writer = administrativeActorOrError(actor, ctx.requestId);
    if (writer instanceof Response) return writer;
    try {
      const result = await (ctx.dependencies.administrativeDraftEdit ?? administrativeDraftEditFromCloudflareBindings)({
        versionId,
        thesisId: body.thesisId,
        expectedVersion: body.expectedVersion,
        summary: body.summary,
        invalidation: body.invalidation,
        reason: body.reason,
        actor: writer,
        occurredAt,
      }, ctx.env);
      return json({
        data: result,
        meta: pageMeta(occurredAt, occurredAt, "unavailable"),
      });
    } catch (error) {
      return mapModuleError(error, ctx.requestId, ADMINISTRATIVE_DRAFT_EDIT_ERRORS);
    }
  });
}

function thesisPublicationRoute(action: ThesisPublicationAction) {
  return (_request: Request, ctx: RouteContext): Promise<Response> => withAdmin(ctx, "publisher", async (actor) => {
    const versionId = thesisVersionIdOrNull(ctx.params.versionId);
    if (versionId === null) {
      // 路由已匹配 `.../publish|withdraw`，说明是版本 ID 本身不合法（例如含空格/占位符）。
      return json({
        error: { code: "VALIDATION", message: "论点版本 ID 无效或不受支持", requestId: ctx.requestId },
      }, 400);
    }

    let body: AdministrativeThesisPublicationBody | null;
    try {
      body = await parseAdministrativeThesisPublicationBody(ctx.request);
    } catch (error) {
      if (error instanceof AdministrativeBodyTooLargeError) {
        return administrativeBodyTooLargeResponse(ctx.requestId);
      }
      throw error;
    }
    if (body === null) {
      return json({
        error: { code: "VALIDATION", message: "发布或撤回请求无效", requestId: ctx.requestId },
      }, 400);
    }

    const writer = administrativeActorOrError(actor, ctx.requestId);
    if (writer instanceof Response) return writer;
    const occurredAt = ctx.nowIso();
    try {
      const transition = await (ctx.dependencies.thesisPublication ?? thesisPublicationFromCloudflareBindings)(
        action,
        {
          versionId,
          thesisId: body.thesisId,
          expectedVersion: body.expectedVersion,
          actor: writer,
          reason: body.reason,
          occurredAt,
        },
        ctx.env,
      );
      return json({
        data: publicationResponse(transition),
        meta: pageMeta(occurredAt, occurredAt, "unavailable"),
      });
    } catch (error) {
      return mapModuleError(error, ctx.requestId, THESIS_PUBLICATION_ERRORS);
    }
  });
}

export const thesisPublishRoute = thesisPublicationRoute("publish");
export const thesisWithdrawRoute = thesisPublicationRoute("withdraw");

export function thesisEvaluateRoute(_request: Request, ctx: RouteContext): Promise<Response> {
  return withAdmin(ctx, "editor", async (actor) => {
    const thesisId = ctx.params.thesisId;
    if (!isAdminThesisId(thesisId)) {
      return json({
        error: { code: "NOT_FOUND", message: "未找到该影响论点", requestId: ctx.requestId },
      }, 404);
    }

    let body: AdministrativeThesisEvaluateBody | null;
    try {
      body = await parseAdministrativeThesisEvaluateBody(ctx.request);
    } catch (error) {
      if (error instanceof AdministrativeBodyTooLargeError) {
        return administrativeBodyTooLargeResponse(ctx.requestId);
      }
      throw error;
    }
    if (body === null) {
      return json({
        error: { code: "VALIDATION", message: "重新评估请求无效", requestId: ctx.requestId },
      }, 400);
    }

    const evaluator = administrativeActorOrError(actor, ctx.requestId);
    if (evaluator instanceof Response) return evaluator;
    const now = ctx.nowIso();
    const cutoff = body.cutoff ?? now;
    if (cutoff > now) {
      return json({
        error: { code: "VALIDATION", message: "评估截止时间不能晚于当前时间", requestId: ctx.requestId },
      }, 422);
    }
    try {
      const result = await (ctx.dependencies.thesisEvaluation ?? thesisEvaluationFromCloudflareBindings)({
        thesisId,
        cutoff,
        actor: evaluator,
        reason: body.reason,
      }, ctx.env);
      if (result.status === "blocked") {
        return json({
          error: {
            code: result.reasonCode,
            message: evaluationBlockedMessage(result.reasonCode),
            requestId: ctx.requestId,
          },
        }, 409);
      }
      return json({
        data: {
          thesisId: result.thesisId,
          status: result.status,
          version: result.version,
          cutoff: result.cutoff,
          changeReason: MANUAL_CHANGE_REASON,
        },
        meta: pageMeta(now, result.cutoff, "unavailable"),
      });
    } catch (error) {
      return mapModuleError(error, ctx.requestId, THESIS_EVALUATION_ERRORS);
    }
  });
}

function evaluationBlockedMessage(reasonCode: string): string {
  if (reasonCode === "PENDING_RESEARCH_APPROVAL") return "该论点尚未通过研究审核，不生成草稿";
  if (reasonCode === "PRODUCTION_EVALUATION_DISABLED") return "该论点的生产评估已关闭";
  if (reasonCode === "MISSING_EVALUATION_INPUT") return "缺少该截止时间的评估输入";
  if (reasonCode === "DIRECTION_UNAVAILABLE") return "方向不可用，未生成草稿";
  if (reasonCode === "CONFIDENCE_UNAVAILABLE") return "置信度不可用，未生成草稿";
  if (reasonCode === "NO_SELECTED_EVIDENCE") return "该截止时间没有可用证据";
  return "当前无法生成草稿";
}

export function thesisReviewRoute(_request: Request, ctx: RouteContext): Promise<Response> {
  return withAdmin(ctx, "publisher", async (actor) => {
    const versionId = thesisVersionIdOrNull(ctx.params.versionId);
    if (versionId === null) {
      // 路由已匹配 `.../review`，说明是版本 ID 本身不合法（例如含空格/占位符）。
      return json({
        error: { code: "VALIDATION", message: "论点版本 ID 无效或不受支持", requestId: ctx.requestId },
      }, 400);
    }

    let body: AdministrativeThesisReviewBody | null;
    try {
      body = await parseAdministrativeThesisReviewBody(ctx.request);
    } catch (error) {
      if (error instanceof AdministrativeBodyTooLargeError) {
        return administrativeBodyTooLargeResponse(ctx.requestId);
      }
      throw error;
    }
    if (body === null) {
      return json({
        error: { code: "VALIDATION", message: "审核请求无效", requestId: ctx.requestId },
      }, 400);
    }

    const reviewer = administrativeActorOrError(actor, ctx.requestId);
    if (reviewer instanceof Response) return reviewer;
    const occurredAt = ctx.nowIso();
    try {
      const review = await (ctx.dependencies.thesisChangeReview ?? thesisChangeReviewFromCloudflareBindings)({
        thesisId: body.thesisId,
        afterVersionId: versionId,
        beforeVersionId: body.beforeVersionId,
        decision: body.decision,
        reason: body.reason,
        actor: reviewer,
        occurredAt,
      }, ctx.env);
      return json({
        data: thesisChangeReviewResponse(review),
        meta: pageMeta(occurredAt, occurredAt, "unavailable"),
      });
    } catch (error) {
      return mapModuleError(error, ctx.requestId, THESIS_CHANGE_REVIEW_ERRORS);
    }
  });
}

/**
 * 路径①（2026-09-24）：豁免必须指向该论点真实存在的覆盖缺口，且该论点在该 cutoff 确实没有
 * 已发布版本。缺口不存在或该论点本可发布都返回 422，绝不放行伪造豁免。
 */
function dailyExemptionValidationError(
  exemptions: readonly DailyBriefExemption[],
  resolution: DailyPublicationTargetResolution,
): string | null {
  if (exemptions.length === 0) return null;
  const exemptible = new Set(resolution.exemptibleTargets.map((target) => target.thesisId));
  for (const exemption of exemptions) {
    if (coverageGapOf(exemption.thesisId, exemption.gapId) === null) {
      return `豁免 ${exemption.thesisId} 引用了不存在的覆盖缺口`;
    }
    if (!exemptible.has(exemption.thesisId)) {
      return `豁免 ${exemption.thesisId} 无效：该论点在该截止时间已有已发布版本`;
    }
  }
  return null;
}

/** A missing or unpublished thesis is the only blocker an explicit exemption can cover. */
function blockerCoveredByExemption(blocker: string, exemptedTheses: ReadonlySet<string>): boolean {
  const separator = blocker.indexOf(":");
  if (separator === -1) return false;
  const code = blocker.slice(0, separator);
  const subject = blocker.slice(separator + 1);
  return (code === "TARGET_MISSING" || code === "VERSION_NOT_PUBLISHED") && exemptedTheses.has(subject);
}

/** Only the frozen outcome and its gate verdicts leave the Worker; identities stay private. */
function dailyBriefPublicationResponse(result: DailyBriefResult): {
  readonly briefDate: string;
  readonly status: "published" | "delayed";
  readonly publishedAt: string | null;
  readonly gates: readonly { readonly code: string; readonly status: string }[];
} {
  return {
    briefDate: result.briefDate,
    status: result.status,
    publishedAt: result.publishedAt,
    gates: result.gates.map((gate) => ({ code: gate.code, status: gate.status })),
  };
}

export function adminDailyBriefPublishRoute(_request: Request, ctx: RouteContext): Promise<Response> {
  return withAdmin(ctx, "publisher", async (actor) => {
    const briefDate = ctx.params.date;
    if (!isPublicDailyBriefDate(briefDate)) {
      return json({
        error: { code: "VALIDATION", message: "每日判定日期必须是有效日历日期", requestId: ctx.requestId },
      }, 400);
    }

    let body: AdministrativeDailyPublicationBody | null;
    try {
      body = await parseAdministrativeDailyPublicationBody(ctx.request);
    } catch (error) {
      if (error instanceof AdministrativeBodyTooLargeError) {
        return administrativeBodyTooLargeResponse(ctx.requestId);
      }
      throw error;
    }
    if (body === null) {
      return json({
        error: { code: "VALIDATION", message: "每日判定发布请求无效", requestId: ctx.requestId },
      }, 400);
    }
    if (shanghaiBriefDate(body.cutoff) !== briefDate) {
      return json({
        error: {
          code: "VALIDATION",
          message: "截止时间与发布日期的北京时间日切不一致",
          requestId: ctx.requestId,
        },
      }, 422);
    }

    const publisher = administrativeActorOrError(actor, ctx.requestId);
    if (publisher instanceof Response) return publisher;

    const occurredAt = ctx.nowIso();
    try {
      const resolution = await (ctx.dependencies.dailyPublicationTargets ?? dailyPublicationTargetsFromCloudflareBindings)(
        body.cutoff,
        ctx.env,
      );
      const exemptionError = dailyExemptionValidationError(body.exemptions, resolution);
      if (exemptionError !== null) {
        return json({
          error: { code: "EXEMPTION_INVALID", message: exemptionError, requestId: ctx.requestId },
        }, 422);
      }
      const exemptedTheses = new Set<string>(body.exemptions.map((exemption) => exemption.thesisId));
      const targets = resolution.resolvableTargets.filter((target) => !exemptedTheses.has(target.thesisId));
      const uncoveredBlockers = resolution.blockers.filter((blocker) =>
        !blockerCoveredByExemption(blocker, exemptedTheses));
      if (
        uncoveredBlockers.length > 0
        || targets.length + body.exemptions.length !== REQUIRED_DAILY_THESIS_IDS.length
      ) {
        return json({
          error: {
            code: "TARGETS_UNAVAILABLE",
            message: "六条论点尚未全部具备该截止时间的已发布版本或已确认豁免，请先完成论点发布",
            requestId: ctx.requestId,
          },
        }, 409);
      }
      const result = await (ctx.dependencies.dailyBriefFreeze ?? dailyBriefFreezeFromCloudflareBindings)({
        cutoff: body.cutoff,
        targets,
        headline: body.headline,
        summary: body.summary,
        topChanges: [...body.topChanges],
        actor: publisher,
        reason: body.reason,
        occurredAt,
        expectedFreezeKey: body.expectedFreezeKey,
        exemptions: [...body.exemptions],
      }, ctx.env);
      if (result.status !== "published") {
        const failedGates = result.gates.filter((gate) => gate.status !== "passed");
        const failed = failedGates.map((gate) => gate.code).join(", ");
        return json({
          error: {
            code: "GATES_FAILED",
            message: failed.length === 0
              ? "发布门禁未通过，未发布每日判定"
              : `发布门禁未通过：${failed}`,
            requestId: ctx.requestId,
            // 只回传稳定的门禁/原因枚举，浏览器据此给出可操作解释，不渲染服务端文案。
            details: {
              gates: failedGates.map((gate) => ({ code: gate.code, reasons: gate.reasons })),
            },
          },
        }, 409);
      }
      return json({
        data: dailyBriefPublicationResponse(result),
        meta: pageMeta(occurredAt, result.cutoff, "unavailable"),
      });
    } catch (error) {
      return mapModuleError(error, ctx.requestId, DAILY_BRIEF_PUBLICATION_ERRORS);
    }
  });
}

export function adminDailyBriefRoute(_request: Request, ctx: RouteContext): Promise<Response> {
  return withAdmin(ctx, "viewer", async (actor) => {
    const briefDate = ctx.params.date;
    if (!isPublicDailyBriefDate(briefDate)) {
      return json({
        error: { code: "VALIDATION", message: "每日判定日期必须是有效日历日期", requestId: ctx.requestId },
      }, 400);
    }
    const generatedAt = ctx.nowIso();
    try {
      const read = await (ctx.dependencies.adminDailyBrief ?? adminDailyBriefFromCloudflareBindings)(
        briefDate,
        ctx.env,
      );
      return json({
        data: { actor: adminActor(actor), ...read },
        meta: pageMeta(generatedAt, read.cutoff, "unavailable"),
      });
    } catch (error) {
      return mapModuleError(error, ctx.requestId, DAILY_BRIEF_PUBLICATION_ERRORS);
    }
  });
}

export function manualSourceRunRoute(_request: Request, ctx: RouteContext): Promise<Response> {
  return withAdmin(ctx, "editor", async (actor) => {
    let body: { readonly reason: string } | null;
    try {
      body = await parseManualSourceRunBody(ctx.request);
    } catch (error) {
      if (error instanceof AdministrativeBodyTooLargeError) {
        return administrativeBodyTooLargeResponse(ctx.requestId);
      }
      throw error;
    }
    const idempotencyKey = parseIdempotencyKey(ctx.request.headers.get("idempotency-key"));
    if (body === null || idempotencyKey === null) {
      return json({
        error: {
          code: "VALIDATION",
          message: "手动运行需要填写原因和有效的幂等键",
          requestId: ctx.requestId,
        },
      }, 400);
    }

    // 与其它写路由一致：手动来源运行是追加型审计事件，必须落在真实 Access 成员身份上。
    const writer = administrativeActorOrError(actor, ctx.requestId);
    if (writer instanceof Response) return writer;

    const occurredAt = ctx.nowIso();
    try {
      const result = await (ctx.dependencies.manualSourceRun ?? manualSourceRunFromCloudflareBindings)({
        sourceId: ctx.params.sourceId,
        reason: body.reason,
        idempotencyKey,
        actor: writer,
        occurredAt,
        operationId: ctx.dependencies.createId?.() ?? crypto.randomUUID(),
      }, ctx.env);
      return json({
        data: result,
        meta: pageMeta(occurredAt, occurredAt, "unavailable"),
      });
    } catch (error) {
      return mapModuleError(error, ctx.requestId, MANUAL_SOURCE_RUN_ERRORS);
    }
  });
}

/** Reviews are audit records: only the reviewed identity and the decision leave the Worker. */
function thesisChangeReviewResponse(review: ThesisChangeReviewRecord): {
  readonly thesisId: string;
  readonly afterVersionId: string;
  readonly beforeVersionId: string;
  readonly decision: ThesisChangeReviewDecision;
} {
  return {
    thesisId: review.thesisId,
    afterVersionId: review.afterVersionId,
    beforeVersionId: review.beforeVersionId,
    decision: review.decision,
  };
}

function publicationResponse(transition: ThesisPublicationTransition): {
  readonly action: ThesisPublicationAction;
  readonly thesisId: string;
  readonly expectedVersion: number;
  readonly currentPublished: Omit<NonNullable<ThesisPublicationTransition["currentPublished"]>, "publishedBy"> | null;
} {
  const current = transition.currentPublished;
  return {
    action: transition.action,
    thesisId: transition.thesisId,
    expectedVersion: transition.expectedVersion,
    currentPublished: current === null ? null : {
      id: current.id,
      thesisId: current.thesisId,
      version: current.version,
      status: current.status,
      direction: current.direction,
      stage: current.stage,
      confidence: current.confidence,
      summary: current.summary,
      invalidation: current.invalidation,
      basedOnCutoff: current.basedOnCutoff,
      publishedAt: current.publishedAt,
    },
  };
}
