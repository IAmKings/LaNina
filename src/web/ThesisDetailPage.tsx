import { useEffect, useState } from "react";

import type { ApiEnvelope } from "../domain/contracts";
import type { ThesisEvidenceModel, ThesisPageModel } from "../domain/page-models";
import { IndicatorChart } from "./IndicatorChart";
import { chartPointSymbol } from "./indicator-markers";
import { directionLabel, formatShanghaiTime, stageLabel } from "./overview-view";
import { evidenceQualityLabel, evidenceStanceLabel, transmissionStages } from "./thesis-view";

type ThesisState =
  | { readonly status: "loading" }
  | { readonly status: "ready"; readonly data: ThesisPageModel }
  | { readonly status: "empty" }
  | { readonly status: "error" };

export function ThesisDetailPage({ slug }: { slug: string }) {
  const [state, setState] = useState<ThesisState>({ status: "loading" });

  useEffect(() => {
    const controller = new AbortController();
    fetch(`/api/v1/theses/${encodeURIComponent(slug)}`, { signal: controller.signal })
      .then(async (response) => {
        if (response.status === 404) {
          setState({ status: "empty" });
          return;
        }
        if (!response.ok) throw new Error("Thesis request failed");
        const body = await response.json() as unknown;
        if (!isThesisEnvelope(body)) throw new Error("Thesis response is malformed");
        setState({ status: "ready", data: body.data });
      })
      .catch((error: unknown) => {
        if (error instanceof DOMException && error.name === "AbortError") return;
        setState({ status: "error" });
      });
    return () => controller.abort();
  }, [slug]);

  if (state.status === "loading") return <PageNotice heading="正在取得已发布论点…" />;
  if (state.status === "empty") return <PageNotice heading="暂无已发布的论点版本。" />;
  if (state.status === "error") return <PageNotice heading="公开论点暂时无法加载。" error />;
  return <ThesisDetail model={state.data} />;
}

export function ThesisDetail({ model }: { model: ThesisPageModel }) {
  const { thesis } = model;
  const sources = uniqueSources(model);
  return (
    <div className="thesis-detail">
      {model.freshness === "stale" ? (
        <aside className="stale-banner" aria-label="数据延迟提醒">
          <strong>数据延迟：</strong>以下内容仍为最近一次已发布版本，截止于 {formatShanghaiTime(thesis.basedOnCutoff)}。
        </aside>
      ) : null}
      <section className="detail-verdict" aria-labelledby="thesis-title">
        <p className="eyebrow">{thesis.category} · 已发布版本 {thesis.version}</p>
        <h1 id="thesis-title">{thesis.title}</h1>
        <p className="detail-summary">{thesis.summary}</p>
        <dl className="detail-meta">
          <div><dt>适用地区</dt><dd>{thesis.region}</dd></div>
          <div><dt>市场标的</dt><dd>{thesis.marketScope}</dd></div>
          <div><dt>当前方向</dt><dd>{directionLabel(thesis.direction)}</dd></div>
          <div><dt>传导阶段</dt><dd>{stageLabel(thesis.stage)}</dd></div>
          <div><dt>置信度</dt><dd>{thesis.confidence} / 100（证据质量，不是价格概率）</dd></div>
          <div><dt>公开时间</dt><dd>{formatShanghaiTime(thesis.publishedAt)}</dd></div>
        </dl>
      </section>

      <section className="content-section" aria-labelledby="invalidation-heading">
        <p className="eyebrow">预先声明的边界</p>
        <h2 id="invalidation-heading">失效条件</h2>
        <p className="invalidation-copy">{model.invalidation}</p>
      </section>

      <section className="content-section" aria-labelledby="transmission-heading">
        <p className="eyebrow">气候 → 区域天气 → 实物 → 供需 → 市场</p>
        <h2 id="transmission-heading">传导路径</h2>
        <ol className="transmission-path">
          {transmissionStages(thesis.stage).map((stage) => (
            <li className={stage.current ? "is-current" : ""} key={stage.id}>
              <span>{stage.current ? "当前" : "阶段"}</span>{stage.label}
            </li>
          ))}
        </ol>
      </section>

      <section className="evidence-grid" aria-label="证据与反向证据">
        <EvidenceColumn heading="支持证据" evidence={model.supportingEvidence} />
        <EvidenceColumn heading="反向证据" evidence={model.counterEvidence} />
      </section>

      <section className="content-section" aria-labelledby="indicators-heading">
        <p className="eyebrow">公开指标</p>
        <h2 id="indicators-heading">关键指标与数据口径</h2>
        {model.indicators.length === 0 ? (
          <p className="muted">当前已发布论点尚无可公开展示的指标序列；证据摘要与来源链接仍保留在上方。</p>
        ) : (
          <div className="indicator-list">
            {model.indicators.map((series) => (
              <article className="indicator-table-wrap" key={series.id}>
                <h3>{series.name} <span>{series.unit}</span></h3>
                <IndicatorChart series={series} />
                {series.missingReason === null ? null : <p className="indicator-missing-reason">缺失说明：{series.missingReason}</p>}
                <table>
                  <caption>图表对应的完整公开指标数据表</caption>
                  <thead><tr><th scope="col">时间口径</th><th scope="col">数值</th><th scope="col">质量</th><th scope="col">来源</th></tr></thead>
                  <tbody>{series.points.map((point) => (
                    <tr className={chartPointSymbol(point) === null ? undefined : "is-marked"} key={`${point.observedAt}-${point.revision}`}>
                      <td>
                        <span>
                          {chartPointSymbol(point) === null ? null : (
                            <span aria-hidden="true" className="indicator-marker">{chartPointSymbol(point)} </span>
                          )}
                          观测 {formatShanghaiTime(point.observedAt)}
                        </span>
                        <span className="indicator-time-detail">发布 {formatShanghaiTime(point.times.publishedAt)} · 采集 {formatShanghaiTime(point.times.fetchedAt)}</span>
                      </td>
                      <td>{point.value === null ? "缺失" : `${point.value} ${point.unit}`}</td>
                      <td>{evidenceQualityLabel(point.quality, point.revision)}</td>
                      <td><a href={point.source.citationUrl} rel="noreferrer" target="_blank">{point.source.name}</a></td>
                    </tr>
                  ))}</tbody>
                </table>
              </article>
            ))}
          </div>
        )}
      </section>

      <section className="content-section" aria-labelledby="versions-heading">
        <p className="eyebrow">公开历史</p>
        <h2 id="versions-heading">版本时间线</h2>
        <ol className="version-timeline">
          {model.versions.map((version) => (
            <li key={version.version}>
              <p><strong>版本 {version.version}</strong> · {directionLabel(version.direction)} · {stageLabel(version.stage)} · 置信度 {version.confidence}</p>
              <p>{version.summary}</p>
              <p className="muted">{formatShanghaiTime(version.publishedAt)}{version.changeReason === null ? "" : ` · ${version.changeReason}`}</p>
            </li>
          ))}
        </ol>
      </section>

      <section className="content-section" aria-labelledby="sources-heading">
        <p className="eyebrow">可回溯来源</p>
        <h2 id="sources-heading">来源与时间口径</h2>
        <ul className="source-list">
          {sources.map((source) => (
            <li key={source.citationUrl}><a href={source.citationUrl} rel="noreferrer" target="_blank">{source.name}</a> · {source.organization}</li>
          ))}
        </ul>
        <p className="muted">证据卡与指标表分别标记观测、发布和采集时间；所有时间均按北京时间展示。</p>
      </section>
    </div>
  );
}

function EvidenceColumn({ heading, evidence }: { heading: string; evidence: readonly ThesisEvidenceModel[] }) {
  return (
    <section className="content-section evidence-column" aria-labelledby={`${heading}-heading`}>
      <p className="eyebrow">{heading === "支持证据" ? "supports" : "counterevidence"}</p>
      <h2 id={`${heading}-heading`}>{heading}</h2>
      {evidence.length === 0 ? <p className="muted">当前公开版本未包含此类证据。</p> : (
        <ol className="evidence-list">{evidence.map((item, index) => (
          <li key={`${item.source.citationUrl}-${index}`}>
            <p className="evidence-type">{evidenceStanceLabel(item.stance)} · {item.layer}</p>
            <p>{item.summary}</p>
            {item.valueLabel === null ? null : <p className="evidence-value">{item.valueLabel}</p>}
            <p className="muted"><a href={item.source.citationUrl} rel="noreferrer" target="_blank">{item.source.name}</a> · {evidenceQualityLabel(item.quality, item.revision)}</p>
            <p className="muted">观测 {formatShanghaiTime(item.times.observedAt)} · 发布 {formatShanghaiTime(item.times.publishedAt)} · 采集 {formatShanghaiTime(item.times.fetchedAt)}</p>
          </li>
        ))}</ol>
      )}
    </section>
  );
}

function PageNotice({ heading, error = false }: { heading: string; error?: boolean }) {
  return <section className={`notice-panel${error ? " is-error" : ""}`} role={error ? "alert" : undefined}><p className="eyebrow">公开论点详情</p><h2>{heading}</h2><p>页面只展示通过发布流程的版本，不以草稿或内部运行数据填补空缺。</p></section>;
}

function uniqueSources(model: ThesisPageModel) {
  const sources = new Map<string, ThesisEvidenceModel["source"]>();
  for (const item of [...model.supportingEvidence, ...model.counterEvidence]) sources.set(item.source.citationUrl, item.source);
  for (const series of model.indicators) for (const point of series.points) sources.set(point.source.citationUrl, point.source);
  return [...sources.values()];
}

function isThesisEnvelope(value: unknown): value is ApiEnvelope<ThesisPageModel> {
  if (value === null || typeof value !== "object") return false;
  const candidate = value as Partial<ApiEnvelope<ThesisPageModel>>;
  return candidate.data !== undefined && candidate.meta !== undefined;
}
