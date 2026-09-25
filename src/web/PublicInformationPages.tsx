import { type FormEvent, useEffect, useState } from "react";

import type { ApiEnvelope } from "../domain/contracts";
import type {
  ChangesPageModel,
  DataHealthPageModel,
  MethodologyPageModel,
  PageLoadState,
  ThesisCardModel,
} from "../domain/page-models";
import { formatShanghaiTime, healthLabel } from "./overview-view";
import {
  CHANGES_FILTER_CATEGORIES,
  categoryLabel,
  changesEndpoint,
  changesFilterFromSearch,
  changesFilterSummary,
  changesSharePath,
  emptyChangesFilter,
  hasActiveChangesFilter,
  hasHealthWarning,
  hasPublishedMethodology,
  successRateLabel,
  type ChangesFilterState,
} from "./public-information-view";

type PublicInformationState<T> = PageLoadState<T>;

export function ChangesPage() {
  const [filters, setFilters] = useState<ChangesFilterState>(() =>
    changesFilterFromSearch(window.location.search));
  const [pending, setPending] = useState<ChangesFilterState>(filters);

  // The address bar is the single source of truth for the filter selection: back/forward must
  // restore the controls, the summary and the results from the URL, or shared links appear broken.
  useEffect(() => {
    const syncFromLocation = () => {
      const next = changesFilterFromSearch(window.location.search);
      setFilters(next);
      setPending(next);
    };
    window.addEventListener("popstate", syncFromLocation);
    return () => window.removeEventListener("popstate", syncFromLocation);
  }, []);

  const cursor = new URLSearchParams(window.location.search).get("cursor");
  const state = usePublicPage<ChangesPageModel>(changesEndpoint(filters, cursor));
  const theses = usePublicPage<readonly ThesisCardModel[]>("/api/v1/theses");
  const thesisOptions = theses.status === "ready" ? theses.data : [];
  const summary = changesFilterSummary(filters, (thesisId) =>
    thesisOptions.find((thesis) => thesis.id === thesisId)?.title ?? null);

  function applyFilters(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const path = changesSharePath(pending);
    window.history.pushState({}, "", path);
    setFilters(pending);
  }

  function clearFilters() {
    window.history.pushState({}, "", "/changes");
    setPending(emptyChangesFilter());
    setFilters(emptyChangesFilter());
  }

  return (
    <div className="information-page">
      <section className="information-hero" aria-labelledby="changes-title">
        <p className="eyebrow">公开变化</p>
        <h1 id="changes-title">最新变化</h1>
        <p>按检测时间倒序列出已公开论点变更、许可合规的事实观测与来源状态变化。</p>
      </section>

      <section className="content-section" aria-labelledby="changes-filter-title">
        <div className="section-heading">
          <div>
            <p className="eyebrow">筛选</p>
            <h2 id="changes-filter-title">按类别、论点或时间范围筛选</h2>
          </div>
        </div>
        <form className="changes-filter" onSubmit={applyFilters}>
          <div className="changes-filter-field">
            <label htmlFor="changes-filter-category">类别</label>
            <select
              id="changes-filter-category"
              onChange={(event) => setPending({ ...pending, category: event.target.value })}
              value={pending.category}
            >
              <option value="">全部类别</option>
              {CHANGES_FILTER_CATEGORIES.map((category) => (
                <option key={category} value={category}>{categoryLabel(category)}</option>
              ))}
            </select>
          </div>
          <div className="changes-filter-field">
            <label htmlFor="changes-filter-thesis">论点</label>
            <select
              id="changes-filter-thesis"
              onChange={(event) => setPending({ ...pending, thesis: event.target.value })}
              value={pending.thesis}
            >
              <option value="">全部论点</option>
              {thesisOptions.map((thesis) => (
                <option key={thesis.id} value={thesis.id}>{thesis.title}</option>
              ))}
            </select>
          </div>
          <div className="changes-filter-field">
            <label htmlFor="changes-filter-from">起始日（Asia/Shanghai）</label>
            <input
              id="changes-filter-from"
              onChange={(event) => setPending({ ...pending, from: event.target.value })}
              type="date"
              value={pending.from}
            />
          </div>
          <div className="changes-filter-field">
            <label htmlFor="changes-filter-to">结束日（Asia/Shanghai）</label>
            <input
              id="changes-filter-to"
              onChange={(event) => setPending({ ...pending, to: event.target.value })}
              type="date"
              value={pending.to}
            />
          </div>
          <div className="changes-filter-actions">
            <button className="admin-action-button" type="submit">应用筛选</button>
            <button onClick={clearFilters} type="button">清除筛选</button>
          </div>
        </form>
        <p className="changes-filter-note">
          类别与论点筛选按变化自身的论点归属生效；未关联论点的合规事实只在未筛选时出现。
          筛选条件写入地址栏以便分享与返回。
        </p>
        {summary === null ? null : <p className="changes-filter-summary" role="status">{summary}</p>}
      </section>

      <section className="content-section" aria-labelledby="changes-list-title">
        <div className="section-heading">
          <div>
            <p className="eyebrow">时间线</p>
            <h2 id="changes-list-title">已公开的变化记录</h2>
          </div>
        </div>
        {state.status === "loading" ? <p className="muted" role="status">正在取得最新公开变化…</p> : null}
        {state.status === "error" ? (
          <p className="admin-lifecycle-message is-error" role="alert">公开变化暂时无法加载。</p>
        ) : null}
        {state.status === "ready" ? (
          <>
            {state.data.freshness === "stale" ? (
              <aside className="stale-banner" aria-label="数据延迟提醒">
                <strong>数据延迟：</strong>变化清单仍只展示已公开内容；请结合来源健康状态判断其新鲜度。
              </aside>
            ) : null}
            {state.data.changes.length === 0 ? (
              <p className="muted">
                {hasActiveChangesFilter(filters)
                  ? "当前筛选条件下没有已公开的变化；可调整或清除筛选。"
                  : "暂无已公开的最新变化。"}
              </p>
            ) : (
              <ol className="changes-list changes-list-detailed">
                {state.data.changes.map((change) => (
                  <li key={change.id}>
                    <time dateTime={change.detectedAt}>{formatShanghaiTime(change.detectedAt)}</time>
                    <div>
                      <p><strong>{change.summary}</strong>{change.thesisTitle === null ? "" : ` · ${change.thesisTitle}`}</p>
                      <p className="change-detail">
                        {change.beforeLabel === null ? "此前值未公开" : `此前：${change.beforeLabel}`} · 当前：{change.afterLabel} ·
                        {change.publishedInCurrentThesis ? " 已进入当前公开论点" : " 尚未关联当前公开论点"}
                      </p>
                      {change.source === null ? null : (
                        <p className="change-detail">
                          来源：<a href={change.source.citationUrl}>{change.source.organization} · {change.source.name}</a>
                        </p>
                      )}
                    </div>
                  </li>
                ))}
              </ol>
            )}
            {state.data.nextCursor === null ? null : (
              <p className="pagination-link">
                <a href={changesSharePathWithCursor(filters, state.data.nextCursor)}>查看更早的公开变化</a>
              </p>
            )}
          </>
        ) : null}
      </section>
    </div>
  );
}

function changesSharePathWithCursor(filters: ChangesFilterState, cursor: string): string {
  return `${changesSharePath(filters)}${changesSharePath(filters).includes("?") ? "&" : "?"}cursor=${encodeURIComponent(cursor)}`;
}

export function DataHealthPage() {
  const state = usePublicPage<DataHealthPageModel>("/api/v1/data-health");

  if (state.status === "loading") return <InformationNotice eyebrow="公开数据状态" heading="正在取得来源健康状态…" />;
  if (state.status === "error") return <InformationNotice eyebrow="公开数据状态" heading="公开数据健康暂时无法加载。" error />;
  if (state.data.sources.length === 0) {
    return <InformationNotice eyebrow="公开数据状态" heading="暂无可公开展示的来源健康记录。" />;
  }

  return (
    <div className="information-page">
      {hasHealthWarning(state.data) ? (
        <aside className="stale-banner" aria-label="来源状态提醒">
          <strong>来源状态提醒：</strong>部分来源未处于正常状态；每行均保留其最近成功采集时间，不以缺失值替代为零。
        </aside>
      ) : null}
      <section className="information-hero" aria-labelledby="data-health-title">
        <p className="eyebrow">公开数据状态</p>
        <h1 id="data-health-title">数据健康</h1>
        <p>展示已启用来源的更新频率、最新公开发布时间、成功采集时间和近七天成功率；内部错误详情不在此页出现。</p>
      </section>
      <section className="content-section" aria-labelledby="data-health-list-title">
        <div className="section-heading">
          <div>
            <p className="eyebrow">来源</p>
            <h2 id="data-health-list-title">公开来源健康记录</h2>
          </div>
          <span className="muted">生成于 {formatShanghaiTime(state.data.generatedAt)}</span>
        </div>
        <div className="health-source-list">
          {state.data.sources.map((source) => (
            <article className="health-source" key={source.sourceId}>
              <div className="health-source-heading">
                <div>
                  <p className="eyebrow">{source.organization}</p>
                  <h3><a href={source.homepageUrl}>{source.name}</a></h3>
                </div>
                <span className={`health-status ${source.status}`}>{healthLabel(source.status)}</span>
              </div>
              <dl className="source-meta">
                <div><dt>更新频率</dt><dd>每 {source.cadenceMinutes} 分钟</dd></div>
                <div><dt>最新来源发布时间</dt><dd>{formatShanghaiTime(source.lastSuccessAt)}</dd></div>
                <div><dt>最近成功采集</dt><dd>{formatShanghaiTime(source.lastFetchedAt)}</dd></div>
                <div><dt>近 7 天成功率</dt><dd>{successRateLabel(source.sevenDaySuccessRate)}</dd></div>
              </dl>
              <p className="source-scope">
                影响指标：{source.affectedIndicators.length === 0 ? "暂无公开指标" : source.affectedIndicators.join("、")}<br />
                影响论点：{source.affectedTheses.length === 0 ? "暂无当前公开论点" : source.affectedTheses.join("、")}
              </p>
            </article>
          ))}
        </div>
      </section>
    </div>
  );
}

export function MethodologyPage() {
  const state = usePublicPage<MethodologyPageModel>("/api/v1/methodology");

  if (state.status === "loading") return <InformationNotice eyebrow="研究方法" heading="正在取得已发布方法论…" />;
  if (state.status === "error") return <InformationNotice eyebrow="研究方法" heading="公开方法论暂时无法加载。" error />;
  if (!hasPublishedMethodology(state.data)) {
    return <InformationNotice eyebrow="研究方法" heading="暂无已发布的方法论版本。" />;
  }

  return (
    <div className="information-page">
      <section className="information-hero" aria-labelledby="methodology-title">
        <p className="eyebrow">研究方法</p>
        <h1 id="methodology-title">方法论与已知局限</h1>
        <p>当前公开版本为 {state.data.methodologyVersion}，最近随已发布每日判定于 {formatShanghaiTime(state.data.lastUpdatedAt)} 更新。</p>
      </section>
      <section className="methodology-grid" aria-label="方法论章节">
        {state.data.sections.map((section) => (
          <article className="content-section methodology-card" key={section.id}>
            <p className="eyebrow">{section.id}</p>
            <h2>{section.title}</h2>
            <p>{section.summary}</p>
          </article>
        ))}
      </section>
      {state.data.coverageGaps.length === 0 ? null : (
        <section className="content-section coverage-gap-section" aria-labelledby="methodology-coverage-gap-title">
          <p className="eyebrow">数据覆盖不足</p>
          <h2 id="methodology-coverage-gap-title">当前已如实标注的覆盖缺口</h2>
          <ul className="coverage-gap-list">
            {state.data.coverageGaps.map((gap) => (
              <li key={gap.thesisId}>
                <strong>{gap.title}</strong>
                <span>数据覆盖不足：{gap.gapDescription}</span>
                <span className="muted">该判断在覆盖缺口关闭前不发布方向与置信度。</span>
              </li>
            ))}
          </ul>
        </section>
      )}
    </div>
  );
}

function InformationNotice({ eyebrow, heading, error = false }: {
  eyebrow: string;
  heading: string;
  error?: boolean;
}) {
  return (
    <section className={`notice-panel${error ? " is-error" : ""}`} role={error ? "alert" : undefined}>
      <p className="eyebrow">{eyebrow}</p>
      <h2>{heading}</h2>
      <p>页面只显示公开 Read Model，不会以草稿、运行记录或原始来源内容填补空缺。</p>
    </section>
  );
}

function usePublicPage<T>(endpoint: string): PublicInformationState<T> {
  const [state, setState] = useState<PublicInformationState<T>>({ status: "loading" });

  useEffect(() => {
    const controller = new AbortController();
    fetch(endpoint, { signal: controller.signal })
      .then(async (response) => {
        if (!response.ok) throw new Error("Public page request failed");
        const body = await response.json() as unknown;
        if (!isPublicEnvelope<T>(body)) throw new Error("Public page response is malformed");
        setState({ status: "ready", data: body.data });
      })
      .catch((error: unknown) => {
        if (error instanceof DOMException && error.name === "AbortError") return;
        setState({ status: "error", message: "公开页面暂时无法加载。" });
      });
    return () => controller.abort();
  }, [endpoint]);

  return state;
}

function isPublicEnvelope<T>(value: unknown): value is ApiEnvelope<T> {
  if (value === null || typeof value !== "object") return false;
  const candidate = value as Partial<ApiEnvelope<T>>;
  return candidate.data !== undefined && candidate.meta !== undefined;
}
