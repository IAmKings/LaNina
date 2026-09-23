import { type FormEvent, useEffect, useState } from "react";

import type { ApiEnvelope } from "../domain/contracts";
import type { ThesisPublicationAction } from "../domain/thesis-publication";
import type { AdminDraftPageModel, PageLoadState } from "../domain/page-models";
import {
  canSubmitLifecycle,
  draftComparisonRows,
  hasReviewableDraft,
  lifecycleActionLabel,
  lifecycleFailureMessage,
  lifecycleTargets,
  mayShowLifecycleControls,
  type ThesisLifecycleTarget,
} from "./admin-draft-view";

type AdminDraftState = PageLoadState<AdminDraftPageModel>;

interface LifecycleFormState {
  readonly action: ThesisPublicationAction;
  readonly reason: string;
  readonly confirmed: boolean;
  readonly status: "editing" | "submitting" | "error" | "success";
  readonly message: string | null;
}

export function AdminDraftPage({ thesisId }: { thesisId: string }) {
  const [state, setState] = useState<AdminDraftState>({ status: "loading" });
  const [reloadToken, setReloadToken] = useState(0);
  const [lifecycle, setLifecycle] = useState<LifecycleFormState | null>(null);

  useEffect(() => {
    const controller = new AbortController();

    fetch(`/api/admin/theses/${encodeURIComponent(thesisId)}/draft`, { signal: controller.signal })
      .then(async (response) => {
        if (!response.ok) throw new Error("Admin draft request failed");
        const body = await response.json() as unknown;
        if (!isAdminDraftEnvelope(body)) throw new Error("Admin draft response is malformed");
        setState({ status: "ready", data: body.data });
      })
      .catch((error: unknown) => {
        if (error instanceof DOMException && error.name === "AbortError") return;
        setState({ status: "error", message: "后台草稿审核暂时无法加载。" });
      });

    return () => controller.abort();
  }, [reloadToken, thesisId]);

  if (state.status === "loading") {
    return <AdminDraftNotice heading="正在取得草稿审核信息…" />;
  }
  if (state.status === "error") {
    return <AdminDraftNotice heading={state.message} error />;
  }
  if (!hasReviewableDraft(state.data)) {
    return <AdminDraftNotice heading="此论点当前没有待审核草稿。" />;
  }

  const model = state.data;
  const targets = lifecycleTargets(model);
  const activeTarget = lifecycle === null ? null : targets.find((target) => target.action === lifecycle.action) ?? null;
  const controlsAvailable = mayShowLifecycleControls(model);
  const isActionBusy = lifecycle?.status === "submitting" || lifecycle?.status === "success";

  function beginLifecycle(action: ThesisPublicationAction) {
    setLifecycle({ action, reason: "", confirmed: false, status: "editing", message: null });
  }

  function cancelLifecycle() {
    if (lifecycle?.status !== "submitting") setLifecycle(null);
  }

  async function submitLifecycle(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (lifecycle === null || activeTarget === null || !canSubmitLifecycle(lifecycle.reason, lifecycle.confirmed, activeTarget)) {
      return;
    }

    setLifecycle({ ...lifecycle, status: "submitting", message: null });
    try {
      const response = await fetch(`/api/admin/thesis-versions/${encodeURIComponent(activeTarget.versionId)}/${lifecycle.action}`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          thesisId: model.thesis.id,
          expectedVersion: activeTarget.expectedVersion,
          reason: lifecycle.reason.trim(),
          confirm: true,
        }),
      });
      if (!response.ok) {
        setLifecycle({
          ...lifecycle,
          status: "error",
          message: lifecycleFailureMessage(response.status),
        });
        return;
      }

      setLifecycle({
        ...lifecycle,
        status: "success",
        message: lifecycle.action === "publish" ? "草稿已提交发布，正在刷新审核信息。" : "当前公开版本已撤回，正在刷新审核信息。",
      });
      setReloadToken((token) => token + 1);
    } catch {
      setLifecycle({ ...lifecycle, status: "error", message: "发布操作暂时无法完成，请稍后重试。" });
    }
  }

  return (
    <div className="admin-page">
      <section className="information-hero" aria-labelledby="admin-draft-title">
        <p className="eyebrow">研究后台 · 审核</p>
        <h1 id="admin-draft-title">{model.thesis.title}</h1>
        <p>仅展示当前草稿与当前公开版本的受限对比。计算输入、证据、快照、审计记录和身份凭据不会进入浏览器。</p>
        <p className="admin-actor">当前已验证成员：{model.actor.email} · 角色：{model.actor.roles.join("、")}</p>
      </section>

      <section className="content-section" aria-labelledby="admin-draft-comparison-title">
        <div className="section-heading">
          <div>
            <p className="eyebrow">版本审核</p>
            <h2 id="admin-draft-comparison-title">待审核草稿 v{model.draft.version}</h2>
          </div>
          <span className="muted">当前公开版本：{model.thesis.currentPublishedVersion === null ? "无" : `v${model.thesis.currentPublishedVersion}`}</span>
        </div>
        <div className="admin-runs-table-wrap draft-comparison-wrap">
          <table>
            <thead>
              <tr>
                <th scope="col">字段</th>
                <th scope="col">当前公开版本</th>
                <th scope="col">待审核草稿</th>
              </tr>
            </thead>
            <tbody>
              {draftComparisonRows(model).map((row) => (
                <tr className={row.changed ? "is-changed" : undefined} key={row.field}>
                  <th scope="row">{row.field}</th>
                  <td>{row.published}</td>
                  <td>{row.draft}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      {controlsAvailable ? (
        <LifecycleControls
          lifecycle={lifecycle}
          target={activeTarget}
          targets={targets}
          disabled={isActionBusy}
          onBegin={beginLifecycle}
          onCancel={cancelLifecycle}
          onChange={setLifecycle}
          onSubmit={submitLifecycle}
        />
      ) : (
        <section className="content-section admin-lifecycle-readonly" aria-labelledby="admin-lifecycle-title">
          <p className="eyebrow">发布控制</p>
          <h2 id="admin-lifecycle-title">仅发布者可执行</h2>
          <p>你可以审核版本差异，但发布和撤回操作由服务端的 publisher 权限再次验证。</p>
        </section>
      )}
    </div>
  );
}

function LifecycleControls({
  lifecycle,
  target,
  targets,
  disabled,
  onBegin,
  onCancel,
  onChange,
  onSubmit,
}: {
  lifecycle: LifecycleFormState | null;
  target: ThesisLifecycleTarget | null;
  targets: readonly ThesisLifecycleTarget[];
  disabled: boolean;
  onBegin: (action: ThesisPublicationAction) => void;
  onCancel: () => void;
  onChange: (state: LifecycleFormState | null) => void;
  onSubmit: (event: FormEvent<HTMLFormElement>) => void;
}) {
  return (
    <section className="content-section admin-lifecycle" aria-labelledby="admin-lifecycle-title">
      <div className="section-heading">
        <div>
          <p className="eyebrow">发布控制</p>
          <h2 id="admin-lifecycle-title">受控发布与撤回</h2>
        </div>
      </div>
      <p className="admin-lifecycle-copy">提交会要求服务器重新验证发布者身份、版本号及确认标记，并会记录操作原因。当前页面的角色显示只控制界面，不代替服务端授权。</p>
      <div className="admin-lifecycle-actions">
        {targets.map((candidate) => (
          <button
            className={candidate.action === "withdraw" ? "admin-action-button is-danger" : "admin-action-button"}
            disabled={disabled}
            key={candidate.action}
            onClick={() => onBegin(candidate.action)}
            type="button"
          >
            {lifecycleActionLabel(candidate.action)}（v{candidate.expectedVersion}）
          </button>
        ))}
      </div>
      {lifecycle === null ? null : (
        <form className="admin-lifecycle-form" onSubmit={onSubmit}>
          <h3>{lifecycleActionLabel(lifecycle.action)}确认</h3>
          <p>目标为已审核的 v{target?.expectedVersion ?? "—"}。此操作不会修改研究计算或证据；请填写可审计的业务原因。</p>
          <label htmlFor="lifecycle-reason">操作原因</label>
          <textarea
            disabled={lifecycle.status === "submitting" || lifecycle.status === "success"}
            id="lifecycle-reason"
            maxLength={500}
            onChange={(event) => onChange({ ...lifecycle, reason: event.target.value, status: "editing", message: null })}
            required
            rows={3}
            value={lifecycle.reason}
          />
          <label className="admin-confirmation">
            <input
              checked={lifecycle.confirmed}
              disabled={lifecycle.status === "submitting" || lifecycle.status === "success"}
              onChange={(event) => onChange({ ...lifecycle, confirmed: event.target.checked, status: "editing", message: null })}
              type="checkbox"
            />
            <span>我已核对版本差异，并确认执行{lifecycle.action === "publish" ? "发布" : "撤回"}。</span>
          </label>
          {lifecycle.message === null ? null : (
            <p
              className={lifecycle.status === "error" ? "admin-lifecycle-message is-error" : "admin-lifecycle-message"}
              role={lifecycle.status === "error" ? "alert" : "status"}
            >
              {lifecycle.message}
            </p>
          )}
          <div className="admin-lifecycle-actions">
            <button
              className={lifecycle.action === "withdraw" ? "admin-action-button is-danger" : "admin-action-button"}
              disabled={lifecycle.status === "submitting" || lifecycle.status === "success" || !canSubmitLifecycle(lifecycle.reason, lifecycle.confirmed, target)}
              type="submit"
            >
              {lifecycle.status === "submitting" ? "正在提交…" : `确认${lifecycle.action === "publish" ? "发布" : "撤回"}`}
            </button>
            <button disabled={lifecycle.status === "submitting"} onClick={onCancel} type="button">取消</button>
          </div>
        </form>
      )}
    </section>
  );
}

function AdminDraftNotice({ heading, error = false }: { heading: string; error?: boolean }) {
  return (
    <section className={`notice-panel${error ? " is-error" : ""}`} role={error ? "alert" : undefined}>
      <p className="eyebrow">研究后台 · 审核</p>
      <h2>{heading}</h2>
      <p>草稿审核页只展示必要的受限版本投影；发布或撤回仍由服务端的 Cloudflare Access 权限与版本校验决定。</p>
    </section>
  );
}

function isAdminDraftEnvelope(value: unknown): value is ApiEnvelope<AdminDraftPageModel> {
  if (value === null || typeof value !== "object") return false;
  const candidate = value as Partial<ApiEnvelope<AdminDraftPageModel>>;
  return candidate.data !== undefined && candidate.meta !== undefined;
}
