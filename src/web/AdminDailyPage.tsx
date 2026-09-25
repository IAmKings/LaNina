import { type FormEvent, useEffect, useState } from "react";

import type {
  AdminDailyPageModel,
  AdminDailyReviewObligationModel,
  PageLoadState,
} from "../domain/page-models";
import {
  blockerLabel,
  canSubmitDaily,
  dailyCutoffLabel,
  dailyPublishBlockReason,
  dailyPublishFailureMessage,
  dailyPublishRequestBody,
  dailyPublishedLabel,
  dailyTargetRows,
  dailyDraftTargets,
  dailyUncoveredBlockers,
  gateLabel,
  gateReasonLabel,
  mayPublishDaily,
  emptyDailyPublishDraft,
  isAdminDailyEnvelope,
  parseTopChangeIds,
  reviewTriggerLabel,
  safeErrorCode,
  safeDailyPublishError,
  shanghaiToday,
  thesisChangeReviewRequestBody,
  thesisVersionPublishRequestBody,
  type DailyGateFailure,
  type DailyPublishDraft,
} from "./admin-daily-view";

type AdminDailyState = PageLoadState<AdminDailyPageModel>;

interface SubmitState {
  readonly status: "editing" | "submitting" | "error" | "success";
  readonly message: string | null;
  /** Structured gate diagnostics returned with GATES_FAILED. */
  readonly gates?: readonly DailyGateFailure[];
}

/** Today in the product time zone, so an operator lands on the brief they can actually publish. */
export function AdminDailyPage({ briefDate = shanghaiToday() }: { briefDate?: string }) {
  const [state, setState] = useState<AdminDailyState>({ status: "loading" });
  const [reloadToken, setReloadToken] = useState(0);
  const [draft, setDraft] = useState<DailyPublishDraft>(emptyDailyPublishDraft());
  const [submit, setSubmit] = useState<SubmitState>({ status: "editing", message: null });
  const [batch, setBatch] = useState<SubmitState>({ status: "editing", message: null });
  const [batchReason, setBatchReason] = useState("");
  const [review, setReview] = useState<SubmitState>({ status: "editing", message: null });
  const [reviewReason, setReviewReason] = useState("");
  /**
   * The concurrency token (`currentFreezeKey`) must be current before a publish may be submitted,
   * otherwise a fast retry submits the stale token and fails again with VERSION_CONFLICT. The
   * loaded-token pair is derived state: a reload token above the loaded one means the projection is
   * still being refetched, so the submit control stays disabled.
   */
  const [loadedToken, setLoadedToken] = useState(-1);

  useEffect(() => {
    const controller = new AbortController();

    fetch(`/api/admin/daily/${encodeURIComponent(briefDate)}`, { signal: controller.signal })
      .then(async (response) => {
        if (!response.ok) throw new Error("Admin daily request failed");
        const body = await response.json() as unknown;
        if (!isAdminDailyEnvelope(body)) throw new Error("Admin daily response is malformed");
        setState({ status: "ready", data: body.data });
        setLoadedToken(reloadToken);
      })
      .catch((error: unknown) => {
        if (error instanceof DOMException && error.name === "AbortError") return;
        setState({ status: "error", message: "每日判定预检暂时无法加载。" });
      });

    return () => controller.abort();
  }, [briefDate, reloadToken]);

  if (state.status === "loading") {
    return <AdminDailyNotice heading="正在取得每日判定预检信息…" briefDate={briefDate} />;
  }
  if (state.status === "error") {
    return <AdminDailyNotice heading={state.message} briefDate={briefDate} error />;
  }

  const model = state.data;
  const blockReason = dailyPublishBlockReason(model);
  const uncoveredBlockers = dailyUncoveredBlockers(model);
  const draftTargets = dailyDraftTargets(model);
  const pendingReviews = model.pendingReviews;
  const changeIds = parseTopChangeIds(draft.topChanges);
  // A successful submit stays busy until the refreshed preflight projection replaces the form.
  // `preflightLoading` blocks a fast retry from reusing a stale concurrency token.
  const preflightLoading = state.status === "ready" && loadedToken !== reloadToken;
  const busy = submit.status === "submitting" || submit.status === "success" || preflightLoading;

  /**
   * 发布该截止时间仍为 draft 的论点版本（服务端逐条重新校验 publisher 权限、版本新鲜度与
   * 生产发布签字）。这是纯操作提速：brief 的编辑内容与冻结仍在原有表单里完成。
   */
  async function publishAllTargets() {
    const reason = batchReason.trim();
    if (draftTargets.length === 0 || reason.length === 0) return;
    setBatch({ status: "submitting", message: `正在发布 ${draftTargets.length} 条论点版本…` });
    const done: string[] = [];
    const failed: string[] = [];
    for (const target of draftTargets) {
      try {
        const response = await fetch(
          `/api/admin/thesis-versions/${encodeURIComponent(target.thesisVersionId)}/publish`,
          {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify(thesisVersionPublishRequestBody(target, reason)),
          },
        );
        if (response.ok) {
          done.push(target.thesisId);
          continue;
        }
        failed.push(`${target.thesisId}（${await safeErrorCode(response) ?? response.status}）`);
      } catch {
        failed.push(`${target.thesisId}（网络）`);
      }
    }
    setReloadToken((token) => token + 1);
    setBatch(
      failed.length === 0
        ? { status: "success", message: `已发布 ${done.length} 条论点版本，可继续发布每日判定。` }
        : { status: "error", message: `已发布 ${done.length} 条；失败：${failed.join("、")}` },
    );
  }

  /**
   * 记录高风险转场审核（方向变化 / 阶段跨级 / 置信度 ≥20）。审核精确绑定上一期已发布判定冻结的
   * 版本，服务端会再次解析并校验，浏览器只是把预检给出的版本身份原样回传。
   */
  async function recordPendingReviews() {
    const reason = reviewReason.trim();
    if (pendingReviews.length === 0 || reason.length === 0) return;
    setReview({ status: "submitting", message: `正在记录 ${pendingReviews.length} 条高风险转场审核…` });
    const done: string[] = [];
    const failed: string[] = [];
    for (const obligation of pendingReviews) {
      try {
        const response = await fetch(
          `/api/admin/thesis-versions/${encodeURIComponent(obligation.afterVersionId)}/review`,
          {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify(thesisChangeReviewRequestBody(obligation, reason)),
          },
        );
        if (response.ok) {
          done.push(obligation.thesisId);
          continue;
        }
        failed.push(`${obligation.thesisId}（${await safeErrorCode(response) ?? response.status}）`);
      } catch {
        failed.push(`${obligation.thesisId}（网络）`);
      }
    }
    setReloadToken((token) => token + 1);
    setReview(
      failed.length === 0
        ? { status: "success", message: `已记录 ${done.length} 条转场审核，可继续发布每日判定。` }
        : { status: "error", message: `已记录 ${done.length} 条；失败：${failed.join("、")}` },
    );
  }

  async function submitPublish(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!canSubmitDaily(draft, model)) return;

    setSubmit({ status: "submitting", message: null });
    try {
      const response = await fetch(`/api/admin/daily/${encodeURIComponent(model.briefDate)}/publish`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(dailyPublishRequestBody(model, draft)),
      });
      if (!response.ok) {
        const error = await safeDailyPublishError(response);
        const base = dailyPublishFailureMessage(response.status, error.code);
        setSubmit({
          status: "error",
          message: error.stage === null ? base : `${base}（写入阶段：${error.stage}）`,
          gates: error.gates,
        });
        setReloadToken((token) => token + 1);
        return;
      }
      setSubmit({ status: "success", message: "每日判定已发布，正在刷新预检信息。" });
      setDraft(emptyDailyPublishDraft());
      setReloadToken((token) => token + 1);
    } catch {
      setSubmit({ status: "error", message: "发布操作暂时无法完成，请稍后重试。" });
    }
  }

  return (
    <div className="admin-page">
      <section className="information-hero" aria-labelledby="admin-daily-title">
        <p className="eyebrow">研究后台 · 每日判定</p>
        <h1 id="admin-daily-title">{model.briefDate} 每日判定发布</h1>
        <p>预检只展示该日期的截止时间、该截止时间的候选论点版本、阻塞原因、可豁免缺口与并发令牌；计算输入、证据、快照与审计记录不会进入浏览器。</p>
        <p className="admin-actor">当前已验证成员：{model.actor.email} · 角色：{model.actor.roles.join("、")}</p>
      </section>

      <section className="content-section" aria-labelledby="admin-daily-status-title">
        <div className="section-heading">
          <div>
            <p className="eyebrow">当日状态</p>
            <h2 id="admin-daily-status-title">{dailyPublishedLabel(model)}</h2>
          </div>
          <span className="muted">评估截止：{dailyCutoffLabel(model)}</span>
        </div>
        <dl className="admin-daily-facts">
          <div>
            <dt>日期</dt>
            <dd>{model.briefDate}</dd>
          </div>
          <div>
            <dt>评估截止（Asia/Shanghai）</dt>
            <dd>{dailyCutoffLabel(model)}</dd>
          </div>
          <div>
            <dt>并发令牌</dt>
            <dd>{model.currentFreezeKey === null ? "尚无冻结尝试" : "已存在一次冻结尝试"}</dd>
          </div>
        </dl>
        <form
          className="admin-daily-date"
          onSubmit={(event) => {
            event.preventDefault();
            const value = new FormData(event.currentTarget).get("briefDate");
            if (typeof value === "string" && /^\d{4}-\d{2}-\d{2}$/.test(value)) {
              window.location.assign(`/admin/daily/${value}`);
            }
          }}
        >
          <label htmlFor="admin-daily-date-input">切换日期</label>
          <input defaultValue={model.briefDate} id="admin-daily-date-input" name="briefDate" pattern="\d{4}-\d{2}-\d{2}" required type="date" />
          <button type="submit">查看该日期</button>
        </form>
      </section>

      <section className="content-section" aria-labelledby="admin-daily-targets-title">
        <div className="section-heading">
          <div>
            <p className="eyebrow">冻结目标</p>
            <h2 id="admin-daily-targets-title">该截止时间的候选版本</h2>
          </div>
          <span className="muted">由服务端按截止时间解析；冻结仍在服务端按已发布版本复核</span>
        </div>
        <div className="admin-runs-table-wrap">
          <table>
            <thead>
              <tr>
                <th scope="col">论点</th>
                <th scope="col">该截止时间版本</th>
                <th scope="col">状态</th>
              </tr>
            </thead>
            <tbody>
              {dailyTargetRows(model).map((row) => (
                <tr key={row.thesisId}>
                  <th scope="row">{row.thesisId}</th>
                  <td>{row.thesisVersionId}（v{row.version}）</td>
                  <td>{row.status === "draft" ? "draft（待发布）" : row.status === "published" ? "已发布" : "已撤回"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        {mayPublishDaily(model) ? (
          <div className="admin-lifecycle-actions">
            <label htmlFor="admin-daily-batch-reason">批量发布原因（写入每条论点版本审计）</label>
            <input
              disabled={batch.status === "submitting"}
              id="admin-daily-batch-reason"
              maxLength={500}
              onChange={(event) => setBatchReason(event.target.value)}
              type="text"
              value={batchReason}
            />
            <button
              type="button"
              onClick={publishAllTargets}
              disabled={batch.status === "submitting" || draftTargets.length === 0 || batchReason.trim().length === 0}
            >
              {draftTargets.length === 0
                ? "没有待发布的 draft 论点版本"
                : `一键发布 ${draftTargets.length} 条 draft 论点版本`}
            </button>
            <p
              className={batch.status === "error" ? "admin-lifecycle-message is-error" : "admin-lifecycle-message"}
              role={batch.status === "error" ? "alert" : "status"}
            >
              {batch.message ?? "先发布 draft 论点版本，再发布每日判定（服务端会逐条复核权限、版本新鲜度与生产发布签字）。"}
            </p>
          </div>
        ) : null}
        {mayPublishDaily(model) && pendingReviews.length > 0 ? (
          <div className="admin-daily-blockers" role="status">
            <p className="eyebrow">高风险转场待审核</p>
            <ul>
              {pendingReviews.map((obligation: AdminDailyReviewObligationModel) => (
                <li key={obligation.thesisId}>
                  <strong>{obligation.thesisId}</strong>：{obligation.triggers.map(reviewTriggerLabel).join("、")}
                  <span className="muted">（相对上一期已发布判定）</span>
                </li>
              ))}
            </ul>
            <label htmlFor="admin-daily-review-reason">审核原因（写入每条转场审核）</label>
            <input
              disabled={review.status === "submitting"}
              id="admin-daily-review-reason"
              maxLength={500}
              onChange={(event) => setReviewReason(event.target.value)}
              type="text"
              value={reviewReason}
            />
            <button
              type="button"
              disabled={review.status === "submitting" || reviewReason.trim().length === 0}
              onClick={recordPendingReviews}
            >
              {review.status === "submitting" ? "正在记录…" : `记录并批准 ${pendingReviews.length} 条转场审核`}
            </button>
            <p
              className={review.status === "error" ? "admin-lifecycle-message is-error" : "admin-lifecycle-message"}
              role={review.status === "error" ? "alert" : "status"}
            >
              {review.message ?? "高风险变化（方向变化 / 阶段跨级 / 置信度变化 ≥20）必须有精确审核才能发布。"}
            </p>
          </div>
        ) : null}
        {uncoveredBlockers.length === 0 ? null : (
          <div className="admin-daily-blockers" role="status">
            <p className="eyebrow">发布阻塞</p>
            <ul>
              {uncoveredBlockers.map((blocker) => <li key={blocker}>{blockerLabel(blocker)}</li>)}
            </ul>
          </div>
        )}
        {model.exemptibleTargets.length === 0 ? null : (
          <div className="admin-daily-blockers admin-daily-exemptions" role="status">
            <p className="eyebrow">可豁免的覆盖缺口</p>
            <ul>
              {model.exemptibleTargets.map((target) => (
                <li key={target.thesisId}>
                  <strong>{target.thesisId}</strong>：数据覆盖不足 —— {target.gapDescription}
                </li>
              ))}
            </ul>
            <p className="admin-daily-hint">
              这些论点在该截止时间没有已发布版本。豁免不改变数据，也不显示方向或置信度；
              公开发布页面会如实标注覆盖缺口。
            </p>
          </div>
        )}
      </section>

      {blockReason === null ? (
        <section className="content-section admin-lifecycle" aria-labelledby="admin-daily-publish-title">
          <div className="section-heading">
            <div>
              <p className="eyebrow">发布控制</p>
              <h2 id="admin-daily-publish-title">发布该日期的每日判定</h2>
            </div>
          </div>
          <p className="admin-lifecycle-copy">
            提交会要求服务端重新验证发布者身份、目标版本、四类门禁与并发令牌，并记录操作原因。
            标题、摘要与首要变化由人工撰写；目标版本不可在浏览器侧指定。
            {model.exemptibleTargets.length === 0
              ? null
              : "存在覆盖缺口豁免时，服务端会再次核对缺口真实性与该论点确实没有已发布版本。"}
          </p>
          <form className="admin-lifecycle-form" onSubmit={submitPublish}>
            <label htmlFor="admin-daily-headline">标题</label>
            <input
              disabled={busy}
              id="admin-daily-headline"
              maxLength={200}
              onChange={(event) => setDraft({ ...draft, headline: event.target.value })}
              required
              type="text"
              value={draft.headline}
            />

            <label htmlFor="admin-daily-summary">摘要</label>
            <textarea
              disabled={busy}
              id="admin-daily-summary"
              maxLength={2000}
              onChange={(event) => setDraft({ ...draft, summary: event.target.value })}
              required
              rows={4}
              value={draft.summary}
            />

            <label htmlFor="admin-daily-changes">首要变化 ID（最多 3 个，可留空）</label>
            <input
              aria-describedby="admin-daily-changes-hint"
              disabled={busy}
              id="admin-daily-changes"
              onChange={(event) => setDraft({ ...draft, topChanges: event.target.value })}
              type="text"
              value={draft.topChanges}
            />
            <p className="admin-daily-hint" id="admin-daily-changes-hint">
              使用「最新变化」列表中的变化 ID，多个以逗号分隔；服务端只接受 ID，不接受自由文本。
            </p>
            {changeIds.error === null ? null : <p className="admin-lifecycle-message is-error" role="alert">{changeIds.error}</p>}

            <label htmlFor="admin-daily-reason">操作原因</label>
            <textarea
              disabled={busy}
              id="admin-daily-reason"
              maxLength={500}
              onChange={(event) => setDraft({ ...draft, reason: event.target.value })}
              required
              rows={3}
              value={draft.reason}
            />

            {model.exemptibleTargets.length === 0 ? null : (
              <label className="admin-confirmation">
                <input
                  checked={draft.exemptionsConfirmed}
                  disabled={busy}
                  onChange={(event) => setDraft({ ...draft, exemptionsConfirmed: event.target.checked })}
                  type="checkbox"
                />
                <span>
                  我已知悉上述覆盖缺口并同意发布：被豁免论点不显示方向与置信度，公开页面会如实标注数据覆盖不足。
                </span>
              </label>
            )}

            <label className="admin-confirmation">
              <input
                checked={draft.confirmed}
                disabled={busy}
                onChange={(event) => setDraft({ ...draft, confirmed: event.target.checked })}
                type="checkbox"
              />
              <span>我已核对目标版本（含已确认豁免）与四类门禁，并确认发布该日期的每日判定。</span>
            </label>

            {submit.message === null ? null : (
              <p
                className={submit.status === "error" ? "admin-lifecycle-message is-error" : "admin-lifecycle-message"}
                role={submit.status === "error" ? "alert" : "status"}
              >
                {submit.message}
              </p>
            )}

            {submit.status === "error" && (submit.gates?.length ?? 0) > 0 ? (
              <div className="admin-daily-blockers" role="status">
                <p className="eyebrow">未通过的门禁与原因</p>
                <ul>
                  {submit.gates!.map((gate: DailyGateFailure) => (
                    <li key={gate.code}>
                      <strong>{gateLabel(gate.code)}</strong>
                      {gate.reasons.length === 0 ? null : (
                        <ul>
                          {gate.reasons.map((reason) => (
                            <li key={reason}>{gateReasonLabel(reason)}</li>
                          ))}
                        </ul>
                      )}
                    </li>
                  ))}
                </ul>
              </div>
            ) : null}

            <div className="admin-lifecycle-actions">
              <button className="admin-action-button" disabled={busy || !canSubmitDaily(draft, model)} type="submit">
                {busy ? "正在提交…" : "确认发布每日判定"}
              </button>
            </div>
          </form>
        </section>
      ) : (
        <section className="content-section admin-lifecycle-readonly" aria-labelledby="admin-daily-blocked-title">
          <p className="eyebrow">发布控制</p>
          <h2 id="admin-daily-blocked-title">当前不可发布</h2>
          <p>{blockReason}</p>
        </section>
      )}
    </div>
  );
}

function AdminDailyNotice({
  heading,
  briefDate,
  error = false,
}: {
  heading: string;
  briefDate: string;
  error?: boolean;
}) {
  return (
    <section className={`notice-panel${error ? " is-error" : ""}`} role={error ? "alert" : undefined}>
      <p className="eyebrow">研究后台 · 每日判定</p>
      <h2>{heading}</h2>
      <p>{briefDate}：本页只展示受限的预检投影；发布仍由服务端的 Cloudflare Access 权限、门禁与版本校验决定。</p>
      {error ? (
        <p className="notice-panel-action">
          Cloudflare Access 会话约 24 小时后过期，表现为本页显示受限投影（后台请求未携带 JWT）。
          <a href="/api/admin/runs">重新登录 Cloudflare Access</a>，完成登录后回到本页即可恢复。
        </p>
      ) : null}
    </section>
  );
}
