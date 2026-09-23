import { useEffect, useState } from "react";

import type { ApiEnvelope } from "../domain/contracts";
import type { CategoryPageModel, PublicMarketCategory } from "../domain/page-models";
import { directionLabel, formatShanghaiTime, stageLabel } from "./overview-view";
import { categoryEyebrow, categoryRequestPath, hasPublishedCategory } from "./category-view";

type CategoryState =
  | { readonly status: "loading" }
  | { readonly status: "ready"; readonly data: CategoryPageModel }
  | { readonly status: "empty" }
  | { readonly status: "error" };

export function CategoryPage({ category }: { category: PublicMarketCategory }) {
  const [state, setState] = useState<CategoryState>({ status: "loading" });

  useEffect(() => {
    const controller = new AbortController();

    fetch(categoryRequestPath(category), { signal: controller.signal })
      .then(async (response) => {
        if (response.status === 404) {
          setState({ status: "empty" });
          return;
        }
        if (!response.ok) {
          throw new Error("Category request failed");
        }
        const body = await response.json() as unknown;
        if (!isCategoryEnvelope(body)) {
          throw new Error("Category response is malformed");
        }
        setState({ data: body.data, status: "ready" });
      })
      .catch((error: unknown) => {
        if (error instanceof DOMException && error.name === "AbortError") {
          return;
        }
        setState({ status: "error" });
      });

    return () => controller.abort();
  }, [category]);

  if (state.status === "loading") {
    return <CategoryNotice heading="正在取得已发布分类内容…" />;
  }
  if (state.status === "empty") {
    return <CategoryNotice heading="该分类暂无已发布的研究判断。" />;
  }
  if (state.status === "error") {
    return <CategoryNotice heading="公开分类内容暂时无法加载。" error />;
  }
  if (!hasPublishedCategory(state.data)) {
    return <CategoryNotice heading="该分类暂无已发布的研究判断。" />;
  }

  return <CategoryContent model={state.data} />;
}

function CategoryContent({ model }: { model: CategoryPageModel }) {
  return (
    <div className="category-page">
      {model.freshness === "stale" ? (
        <aside className="stale-banner" aria-label="数据延迟提醒">
          <strong>数据延迟：</strong>以下仍是最近一次已发布的分类研究，请结合论点页面的截止时间阅读。
        </aside>
      ) : null}
      <section className="category-hero" aria-labelledby="category-title">
        <p className="eyebrow">{categoryEyebrow(model.category)}</p>
        <h1 id="category-title">{model.title}</h1>
        <p>{model.summary}</p>
      </section>

      <section className="content-section" aria-labelledby="category-theses-heading">
        <div className="section-heading">
          <div>
            <p className="eyebrow">已发布论点</p>
            <h2 id="category-theses-heading">当前市场影响路径</h2>
          </div>
        </div>
        <div className="thesis-grid">
          {model.theses.map((thesis) => (
            <article className="thesis-card" key={thesis.id}>
              <div className="card-meta">
                <span>{thesis.region}</span>
                <span className={"direction " + thesis.direction}>{directionLabel(thesis.direction)}</span>
              </div>
              <h3><a href={`/theses/${thesis.slug}`}>{thesis.title}</a></h3>
              <p>{thesis.summary}</p>
              <footer>
                <span>{stageLabel(thesis.stage)}</span>
                <span>{formatShanghaiTime(thesis.publishedAt)}</span>
              </footer>
            </article>
          ))}
        </div>
      </section>

      <div className="category-support-grid">
        <section className="content-section" aria-labelledby="category-changes-heading">
          <p className="eyebrow">公开更新</p>
          <h2 id="category-changes-heading">近期变化</h2>
          {model.changes.length === 0 ? (
            <p className="muted">当前已发布分类内容没有新的变化记录。</p>
          ) : (
            <ol className="changes-list">
              {model.changes.map((change) => (
                <li key={change.id}>
                  <time dateTime={change.detectedAt}>{formatShanghaiTime(change.detectedAt)}</time>
                  <p>{change.thesisTitle ?? "分类研究"} · {change.summary}</p>
                </li>
              ))}
            </ol>
          )}
        </section>

        <section className="content-section" aria-labelledby="coverage-heading">
          <p className="eyebrow">数据覆盖</p>
          <h2 id="coverage-heading">公开范围说明</h2>
          <ul className="coverage-list">
            {model.coverageGaps.map((gap) => <li key={gap}>{gap}</li>)}
          </ul>
        </section>
      </div>
    </div>
  );
}

function CategoryNotice({ heading, error = false }: { heading: string; error?: boolean }) {
  return (
    <section className={"notice-panel" + (error ? " is-error" : "")} role={error ? "alert" : undefined}>
      <p className="eyebrow">公开分类研究</p>
      <h2>{heading}</h2>
      <p>页面只显示当前已发布的论点与公开变化，不会用草稿或内部运行信息填补空缺。</p>
    </section>
  );
}

function isCategoryEnvelope(value: unknown): value is ApiEnvelope<CategoryPageModel> {
  if (value === null || typeof value !== "object") {
    return false;
  }

  const candidate = value as Partial<ApiEnvelope<CategoryPageModel>>;
  return candidate.data !== undefined && candidate.meta !== undefined;
}
