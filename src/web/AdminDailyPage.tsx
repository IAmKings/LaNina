import { type FormEvent, useEffect, useState } from "react";

import type { AdminDailyPageModel, PageLoadState } from "../domain/page-models";
import {
  blockerLabel,
  canSubmitDaily,
  dailyCutoffLabel,
  dailyPublishBlockReason,
  dailyPublishFailureMessage,
  dailyPublishRequestBody,
  dailyPublishedLabel,
  dailyTargetRows,
  emptyDailyPublishDraft,
  isAdminDailyEnvelope,
  parseTopChangeIds,
  safeErrorCode,
  shanghaiToday,
  type DailyPublishDraft,
} from "./admin-daily-view";

type AdminDailyState = PageLoadState<AdminDailyPageModel>;

interface SubmitState {
  readonly status: "editing" | "submitting" | "error" | "success";
  readonly message: string | null;
}

/** Today in the product time zone, so an operator lands on the brief they can actually publish. */
export function AdminDailyPage({ briefDate = shanghaiToday() }: { briefDate?: string }) {
  const [state, setState] = useState<AdminDailyState>({ status: "loading" });
  const [reloadToken, setReloadToken] = useState(0);
  const [draft, setDraft] = useState<DailyPublishDraft>(emptyDailyPublishDraft());
  const [submit, setSubmit] = useState<SubmitState>({ status: "editing", message: null });

  useEffect(() => {
    const controller = new AbortController();

    fetch(`/api/admin/daily/${encodeURIComponent(briefDate)}`, { signal: controller.signal })
      .then(async (response) => {
        if (!response.ok) throw new Error("Admin daily request failed");
        const body = await response.json() as unknown;
        if (!isAdminDailyEnvelope(body)) throw new Error("Admin daily response is malformed");
        setState({ status: "ready", data: body.data });
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
  const changeIds = parseTopChangeIds(draft.topChanges);
  // A successful submit stays busy until the refreshed preflight projection replaces the form.
  const busy = submit.status === "submitting" || submit.status === "success";

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
        setSubmit({
          status: "error",
          message: dailyPublishFailureMessage(response.status, await safeErrorCode(response)),
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
        <p>预检只展示该日期的截止时间、六条目标版本、阻塞原因与并发令牌；计算输入、证据、快照与审计记录不会进入浏览器。</p>
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
            <h2 id="admin-daily-targets-title">六条论点的目标版本</h2>
          </div>
          <span className="muted">由服务端按截止时间解析</span>
        </div>
        <div className="admin-runs-table-wrap">
          <table>
            <thead>
              <tr>
                <th scope="col">论点</th>
                <th scope="col">目标版本</th>
              </tr>
            </thead>
            <tbody>
              {dailyTargetRows(model).map((row) => (
                <tr key={row.thesisId}>
                  <th scope="row">{row.thesisId}</th>
                  <td>{row.thesisVersionId}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        {model.blockers.length === 0 ? null : (
          <div className="admin-daily-blockers" role="status">
            <p className="eyebrow">发布阻塞</p>
            <ul>
              {model.blockers.map((blocker) => <li key={blocker}>{blockerLabel(blocker)}</li>)}
            </ul>
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
            提交会要求服务端重新验证发布者身份、六条目标版本、四类门禁与并发令牌，并记录操作原因。
            标题、摘要与首要变化由人工撰写；目标版本不可在浏览器侧指定。
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

            <label className="admin-confirmation">
              <input
                checked={draft.confirmed}
                disabled={busy}
                onChange={(event) => setDraft({ ...draft, confirmed: event.target.checked })}
                type="checkbox"
              />
              <span>我已核对六条目标版本与四类门禁，并确认发布该日期的每日判定。</span>
            </label>

            {submit.message === null ? null : (
              <p
                className={submit.status === "error" ? "admin-lifecycle-message is-error" : "admin-lifecycle-message"}
                role={submit.status === "error" ? "alert" : "status"}
              >
                {submit.message}
              </p>
            )}

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
    </section>
  );
}
