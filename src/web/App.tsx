import { lazy, Suspense, type ReactNode, useEffect, useState } from "react";

import type { ApiEnvelope } from "../domain/contracts";
import {
  PUBLIC_MARKET_CATEGORIES,
  type OverviewPageModel,
  type PageLoadState,
  type PublicMarketCategory,
} from "../domain/page-models";
import { CategoryPage } from "./CategoryPage";
import { ChangesPage, DataHealthPage, MethodologyPage } from "./PublicInformationPages";
import {
  directionLabel,
  formatShanghaiTime,
  freshnessLabel,
  hasPublicOverview,
  riskMapEmptyStageLabel,
  riskMapRows,
  stageLabel,
} from "./overview-view";
import { ThesisDetailPage } from "./ThesisDetailPage";
import { shanghaiToday } from "./admin-daily-view";
import { applyPageMetadata } from "./seo";

// Research-admin screens stay behind Access and out of the public first paint: they load on demand
// so the initial client bundle keeps serving public readers only.
const AdminRunsPage = lazy(() =>
  import("./AdminRunsPage").then((module) => ({ default: module.AdminRunsPage })));
const AdminDraftPage = lazy(() =>
  import("./AdminDraftPage").then((module) => ({ default: module.AdminDraftPage })));
const AdminDailyPage = lazy(() =>
  import("./AdminDailyPage").then((module) => ({ default: module.AdminDailyPage })));

export type OverviewState = PageLoadState<OverviewPageModel>;

const NAVIGATION = [
  ["首页", "/"],
  ["天然橡胶", "/rubber"],
  ["农产品", "/agriculture"],
  ["航运", "/shipping"],
  ["最新变化", "/changes"],
  ["数据健康", "/data-health"],
  ["方法论", "/methodology"],
] as const;

export function App() {
  useEffect(() => {
    applyPageMetadata(document, {
      origin: window.location.origin,
      pathname: window.location.pathname,
    });
  }, []);

  // `/admin` 只是 Access 的保护前缀；进入后客户端改址到运行总览（无条件 effect）。
  const bareAdmin = window.location.pathname === "/admin";
  useEffect(() => {
    if (bareAdmin) window.location.replace("/admin/runs");
  }, [bareAdmin]);

  const adminRuns = window.location.pathname === "/admin/runs";
  const adminDailyDate = adminDailyDateFromPath(window.location.pathname);
  const adminDraftThesisId = adminDraftThesisIdFromPath(window.location.pathname);
  const thesisSlug = thesisSlugFromPath(window.location.pathname);
  const category = categoryFromPath(window.location.pathname);
  const informationPage = informationPageFromPath(window.location.pathname);
  const adminRoute = adminRuns
    ? <AdminRunsPage />
    : adminDailyDate !== null
      ? <AdminDailyPage briefDate={adminDailyDate} />
      : adminDraftThesisId !== null
        ? <AdminDraftPage thesisId={adminDraftThesisId} />
        : null;
  if (bareAdmin) {
    return (
      <PageShell currentPath="/admin/runs">
        <AdminRouteFallback />
      </PageShell>
    );
  }
  return (
    <PageShell currentPath={window.location.pathname}>
      {adminRoute !== null
        ? <Suspense fallback={<AdminRouteFallback />}>{adminRoute}</Suspense>
        : thesisSlug !== null
          ? <ThesisDetailPage slug={thesisSlug} />
          : category !== null
            ? <CategoryPage category={category} />
            : informationPage === "changes"
              ? <ChangesPage />
              : informationPage === "data-health"
                ? <DataHealthPage />
                : informationPage === "methodology"
                  ? <MethodologyPage />
                  : <OverviewPage />}
    </PageShell>
  );
}

function AdminRouteFallback() {
  return (
    <section className="notice-panel" role="status">
      <p className="eyebrow">研究后台</p>
      <h2>正在加载后台界面…</h2>
      <p>后台模块按需加载，公开页面不包含它们；访问权限仍由服务端的 Cloudflare Access 决定。</p>
    </section>
  );
}

function adminDraftThesisIdFromPath(pathname: string): string | null {
  const matched = /^\/admin\/theses\/([A-Za-z0-9][A-Za-z0-9_-]{0,127})\/draft$/.exec(pathname);
  return matched?.[1] ?? null;
}

/** `/admin/daily` resolves to the current Asia/Shanghai brief date; an explicit date is preserved. */
function adminDailyDateFromPath(pathname: string): string | null {
  if (pathname === "/admin/daily" || pathname === "/admin/daily/") return shanghaiToday();
  const matched = /^\/admin\/daily\/(\d{4}-\d{2}-\d{2})$/.exec(pathname);
  return matched?.[1] ?? null;
}

function OverviewPage() {
  const [overview, setOverview] = useState<OverviewState>({ status: "loading" });

  useEffect(() => {
    const controller = new AbortController();

    fetch("/api/v1/overview", { signal: controller.signal })
      .then((response) => {
        if (!response.ok) {
          throw new Error("Overview request failed");
        }

        return response.json() as Promise<unknown>;
      })
      .then((body) => {
        if (!isOverviewEnvelope(body)) {
          throw new Error("Overview response is malformed");
        }

        setOverview({ data: body.data, status: "ready" });
      })
      .catch((error: unknown) => {
        if (error instanceof DOMException && error.name === "AbortError") {
          return;
        }

        setOverview({ status: "error", message: "公开概览暂时无法加载。" });
      });

    return () => controller.abort();
  }, []);

  return (
    <>
      <section className="hero" aria-labelledby="overview-heading">
        <p className="eyebrow">Climate → Physical → Market</p>
        <h1 id="overview-heading">把气候信号转化为可核验的市场判断。</h1>
        <p className="lede">
          聚焦厄尔尼诺及相关气候异常对天然橡胶、农产品与航运的滞后影响；每一项公开结论都保留其发布与方法论版本。
        </p>
      </section>
      <OverviewContent overview={overview} />
    </>
  );
}

export function PageShell({ children, currentPath }: { children: ReactNode; currentPath: string }) {
  return (
    <>
      <a className="skip-link" href="#content">
        跳到主要内容
      </a>
      <header className="site-header">
        <div className="site-frame navigation">
          <a className="brand" href="/" aria-label="ENSO 市场影响监测首页">
            <span className="brand-mark" aria-hidden="true">
              E
            </span>
            <span>ENSO 市场影响监测</span>
          </a>
          <nav aria-label="主要导航">
            <ul>
              {NAVIGATION.map(([label, href]) => (
                <li key={href}>
                  <a href={href} aria-current={href === currentPath ? "page" : undefined}>
                    {label}
                  </a>
                </li>
              ))}
            </ul>
          </nav>
        </div>
      </header>

      <main id="content" className="site-frame" tabIndex={-1}>
        {children}
      </main>

      <footer className="site-footer">
        <div className="site-frame">
          <p>市场观点仅供研究参考，不构成投资建议。</p>
          <p>
            所有页面仅展示已发布的研究快照。<a href="/feed.xml">订阅 Atom Feed</a>
          </p>
        </div>
      </footer>
    </>
  );
}

export function OverviewContent({ overview }: { overview: OverviewState }) {
  if (overview.status === "loading") {
    return (
      <section className="notice-panel" aria-live="polite">
        <p className="eyebrow">正在加载</p>
        <h2>正在取得最新已发布的研究快照…</h2>
        <p>不会以草稿或内部运行数据替代公开结论。</p>
      </section>
    );
  }

  if (overview.status === "error") {
    return (
      <section className="notice-panel is-error" role="alert">
        <p className="eyebrow">暂时不可用</p>
        <h2>公开概览暂时无法加载。</h2>
        <p>请稍后重试；页面不会展示不完整或未经发布的数据。</p>
      </section>
    );
  }

  if (!hasPublicOverview(overview.data)) {
    return (
      <section className="notice-panel">
        <p className="eyebrow">等待发布</p>
        <h2>暂无已发布的市场判定。</h2>
        <p>数据接入和研究工作仍在进行中，首个通过发布流程的快照将在这里出现。</p>
      </section>
    );
  }

  const { data } = overview;
  return (
    <div className="overview-content">
      {data.freshness === "stale" ? (
        <aside className="stale-banner" aria-label="数据延迟提醒">
          <strong>数据延迟：</strong>当前仍展示最近一次已发布快照，生成于{" "}
          {formatShanghaiTime(data.dailyBrief?.publishedAt ?? data.theses[0]?.publishedAt ?? null)}。
        </aside>
      ) : null}

      <section className="brief-panel" aria-labelledby="brief-heading">
        <div>
          <p className="eyebrow">最新已发布判定</p>
          <h2 id="brief-heading">{data.dailyBrief?.headline ?? "市场影响概览"}</h2>
        </div>
        <p className="brief-verdict">
          {data.dailyBrief?.summary ?? "已发布论点仍可查看；今日简报尚未公开。"}
        </p>
        <dl className="brief-meta">
          <div>
            <dt>数据截止</dt>
            <dd>{formatShanghaiTime(data.dailyBrief?.dataCutoff ?? null)}</dd>
          </div>
          <div>
            <dt>方法论版本</dt>
            <dd>{data.methodologyVersion}</dd>
          </div>
          <div>
            <dt>公开发布时间</dt>
            <dd>{formatShanghaiTime(data.dailyBrief?.publishedAt ?? data.theses[0]?.publishedAt ?? null)}</dd>
          </div>
        </dl>
      </section>

      <section className="content-section changes-section" aria-labelledby="changes-heading">
        <div className="section-heading">
          <div>
            <p className="eyebrow">研究更新</p>
            <h2 id="changes-heading">今日变化</h2>
          </div>
          <a href="/changes">全部变化</a>
        </div>
        {data.topChanges.length === 0 ? (
          <p className="muted">本次已发布快照没有新增变化。</p>
        ) : (
          <ol className="changes-list">
            {data.topChanges.map((change) => (
              <li key={change.id}>
                <time dateTime={change.detectedAt}>{formatShanghaiTime(change.detectedAt)}</time>
                <p>{change.summary}</p>
              </li>
            ))}
          </ol>
        )}
      </section>

      <section className="content-section" aria-labelledby="theses-heading">
        <div className="section-heading">
          <div>
            <p className="eyebrow">市场影响路径</p>
            <h2 id="theses-heading">正在跟踪的研究判断</h2>
          </div>
          <a href="/methodology">查看方法论</a>
        </div>
        <div className="thesis-grid">
          {data.theses.map((thesis) => (
            <article className="thesis-card" key={thesis.id}>
              <div className="card-meta">
                <span>{thesis.category}</span>
                <span className={"direction " + thesis.direction}>{directionLabel(thesis.direction)}</span>
              </div>
              <h3><a href={`/theses/${thesis.slug}`}>{thesis.title}</a></h3>
              <p>{thesis.summary}</p>
              <footer>
                <span>{stageLabel(thesis.stage)}</span>
                <span>置信度 {thesis.confidence}</span>
              </footer>
            </article>
          ))}
        </div>
      </section>

      {data.coverageGaps.length === 0 ? null : (
        <section className="content-section coverage-gap-section" aria-labelledby="coverage-gap-heading">
          <div className="section-heading">
            <div>
              <p className="eyebrow">数据覆盖不足</p>
              <h2 id="coverage-gap-heading">已如实标注覆盖缺口的判断</h2>
            </div>
            <a href="/methodology">查看方法论</a>
          </div>
          <ul className="coverage-gap-list">
            {data.coverageGaps.map((gap) => (
              <li key={gap.thesisId}>
                <strong>{gap.title}</strong>
                <span>数据覆盖不足：{gap.gapDescription}</span>
                <span className="muted">该判断暂无已发布方向与置信度，不以代理数据替代。</span>
              </li>
            ))}
          </ul>
        </section>
      )}

      <section className="content-section" aria-labelledby="risk-map-heading">
        <div className="section-heading">
          <div>
            <p className="eyebrow">跨市场风险图</p>
            <h2 id="risk-map-heading">六条判断所处的传导阶段</h2>
          </div>
          <span className="muted">不是评分，不合并为单一结论</span>
        </div>
        <div className="risk-map-wrap">
          <table className="risk-map-table">
            <caption>按传导阶段排列的六条影响论点；空阶段同样列出，表示尚无判断到达该层级。</caption>
            <thead>
              <tr>
                <th scope="col">传导阶段</th>
                <th scope="col">影响论点</th>
                <th scope="col">方向</th>
                <th scope="col">置信度</th>
                <th scope="col">数据状态</th>
              </tr>
            </thead>
            <tbody>
              {riskMapRows(data).map((row) => (
                row.theses.length === 0 ? (
                  <tr className="risk-map-empty" key={row.stage}>
                    <th scope="row">{row.stageLabel}</th>
                    <td colSpan={4}>{riskMapEmptyStageLabel()}</td>
                  </tr>
                ) : row.theses.map((thesis, index) => (
                  <tr key={`${row.stage}-${thesis.id}`}>
                    {index === 0 ? (
                      <th rowSpan={row.theses.length} scope="rowgroup">{row.stageLabel}</th>
                    ) : null}
                    <td><a href={`/theses/${thesis.slug}`}>{thesis.title}</a></td>
                    <td><span className={"direction " + thesis.direction}>{thesis.directionLabel}</span></td>
                    <td>{thesis.confidence}</td>
                    <td>{freshnessLabel(thesis.freshness)}</td>
                  </tr>
                ))
              ))}
            </tbody>
          </table>
        </div>
        <p className="risk-map-note">
          阶段表示证据链推进到哪一层，不表示价格方向强度；同一阶段内的判断可以方向相反。
          数据状态为“延迟”时，该行结论仍来自上一已发布版本。
        </p>
      </section>

      <div className="support-grid">
        <section className="content-section health-section" aria-labelledby="health-heading">
          <div className="section-heading">
            <div>
              <p className="eyebrow">公开数据状态</p>
              <h2 id="health-heading">数据健康</h2>
            </div>
            <a href="/data-health">数据详情</a>
          </div>
          <p className="health-summary">正常 {data.sourceHealth.healthy} · 延迟 {data.sourceHealth.delayed} · 过期 {data.sourceHealth.stale} · 故障 {data.sourceHealth.broken}</p>
          <dl className="health-list">
            <div>
              <dt>页面数据新鲜度</dt>
              <dd className={"health-status " + data.freshness}>
                {data.freshness === "current" ? "当前" : "存在延迟"}
              </dd>
            </div>
          </dl>
        </section>
      </div>
    </div>
  );
}

function thesisSlugFromPath(pathname: string): string | null {
  const matched = /^\/theses\/([a-z0-9]+(?:-[a-z0-9]+)*)$/.exec(pathname);
  return matched?.[1] ?? null;
}

function categoryFromPath(pathname: string): PublicMarketCategory | null {
  const matched = /^\/([a-z]+)$/.exec(pathname);
  if (matched === null) {
    return null;
  }

  const category = matched[1];
  return PUBLIC_MARKET_CATEGORIES.includes(category as PublicMarketCategory)
    ? category as PublicMarketCategory
    : null;
}

function informationPageFromPath(pathname: string): "changes" | "data-health" | "methodology" | null {
  if (pathname === "/changes") return "changes";
  if (pathname === "/data-health") return "data-health";
  if (pathname === "/methodology") return "methodology";
  return null;
}

function isOverviewEnvelope(value: unknown): value is ApiEnvelope<OverviewPageModel> {
  if (value === null || typeof value !== "object") {
    return false;
  }

  const candidate = value as Partial<ApiEnvelope<OverviewPageModel>>;
  return candidate.data !== undefined && candidate.meta !== undefined;
}
