# 公开网站与研究后台

## Goal

让读者快速理解每日判定、六条论点及其证据，让研究编辑能够安全地完成来源检查、草稿审核和版本发布。

## Requirements

- Read Model 对每个页面提供一次聚合查询，前端不接触 D1 rows 或外部 payload。
- 实现产品 PRD §10.5 全部公开接口和统一 meta/error envelope。
- 首页两屏内显示 ENSO 判定、今日三项变化和六条论点状态。
- 详情页显示支持/反向证据、失效条件、传导链、4–8 个指标、修订和版本时间线。
- 实现分类、最新变化、数据健康、方法论和 Atom Feed。
- 图表显示单位、来源、观测/发布/采集时间、缺失和修订；不使用误导性双轴。
- 实现 Cloudflare Access 身份校验、viewer/editor/publisher 权限和最小后台。
- 公共接口只读；后台所有写操作审计；公开页面不泄露草稿或私有快照。
- 满足 360/768/1280px、键盘访问、WCAG AA 和性能目标。

## Acceptance Criteria

- [x] `/overview` 一次返回首页全部首屏数据，无卡片级 N+1。
      `cloudflare-read-model-query-plan.test.mjs`：首页访问路径用公开指针与版本身份索引，
      不按卡片扫描版本表（第 18–36 行）；`cloudflare-read-models.test.ts` 断言单批投影。
- [x] 未发布论点在全部公开路由不可见；合规事实变化可见。
      `cloudflare-read-models.test.ts` 断言公开查询仅取 `published` 且不投影 snapshot/audit/draft；
      `index.test.ts` 覆盖未发布 slug/分类的安全 404 与许可允许的事实变化出现在 `/changes`。
- [x] 首页、详情、三类分类、变化、健康、方法论和 Feed 均有 loading/empty/stale/error 状态。
      `App.tsx`、`ThesisDetailPage.tsx`、`CategoryPage.tsx`、`PublicInformationPages.tsx` 各自处理
      loading/error/empty/stale；`atom-feed.test.ts` 覆盖空 Feed 与失败脱敏（Feed 为 XML，无 UI 状态）。
- [x] 详情页同时显示支持与反向证据，且每项可回到来源。
      `ThesisDetailPage.tsx` 以 `证据与反向证据` 双栏渲染 `supportingEvidence`/`counterEvidence`，
      每项附 `citationUrl` 外链与质量/修订标签。
- [x] 图表缺失值不补零，provisional/revision 有视觉和文本标记。
      缺失值不补零由 `indicator-chart.test.ts` 锁定；`src/web/indicator-markers.ts` 定义共享标记
      （修订=菱形、暂定=空心圆），图表数据项只换符号不改数值，`IndicatorChart` 渲染文字图例，
      `ThesisDetailPage` 的数据表行同时给出符号与"暂定/修订 N"文本，并有左侧强调线。
      新增测试覆盖标记映射、图例去重与"标记不改变数值"。
- [x] 360/768/1280px 不发生核心内容截断。
      `e2e/local-published-demo.spec.ts` 在 360×800、768×1024、1280×800 三档下逐一访问
      首页、分类、论点详情、变化、健康、方法论六个公开页面（18 个断言），要求
      `documentElement.scrollWidth ≤ innerWidth + 1`、除"刻意横向滚动容器"外无元素越界、
      H1/主导航/关键区块可见、导航保留 ≥7 个目的地，并为每档留存整页截图；
      详情页额外断言真实 ECharts canvas 可见且宽度不超过视口。本地 demo 中间件补充
      了变化/健康/方法论三个只读投影，使该检查覆盖全部公开页面。
- [x] 键盘能够访问导航、筛选和后台关键操作。
      导航：跳转链接、语义导航与 `aria-current` 由 `public-accessibility.test.ts` 锁定；
      筛选：`/changes` 已实现 PRD §6.5 的类别/论点/时间范围筛选（C8），全部为带标签的表单控件，
      `e2e/local-published-demo.spec.ts` 验证可键盘选择类别、提交后地址栏写入 `?category=…`、
      重新请求带筛选的接口、显示筛选摘要并可清除；后台：发布与审核控件均为带标签的标准控件并要求
      显式确认（`index.test.ts` 覆盖授权与冲突）。**仍需在已配置 Access 的 staging 上完成一次
      键盘发布操作验收**（属发布任务范围）。
- [x] Access 未授权请求被拒绝，角色权限正确。
      `access-auth.test.ts`（JWT/JWKS 验签、iss/aud/exp、角色层级与 fail-closed）与 `index.test.ts`
      的路由级 403/401；**部署侧的 Access application/audience/角色组仍属 staging 证据**
      （见 `09-07-release-quality` 的 AC-11）。
- [x] 发布/撤回有 expected version、二次确认与审计。
      `index.test.ts` 覆盖 publisher 授权、`confirm`、expected version 冲突脱敏；`AdminDraftPage`
      要求非空理由与显式确认；`cloudflare-thesis-publications.test.ts` 覆盖原子转移与审计。
- [x] 初始 JS ≤250KB（图表按需加载），缓存头符合 PRD。
      `check:bundle` 为 224.02 KiB / 250 KiB；ECharts 为独立懒加载 chunk（494.67 kB）；
      公开路由缓存头由 `index.test.ts` 锁定（overview 60/300、series 300、daily 3600、methodology 86400）。

## 验收判定小结（2026-09-14）

- 10 条 AC 全部 `verified-local`：AC-5（标记）由 C6 关闭，AC-6（视口）由 C7 关闭，
  AC-7（键盘/筛选）由 C8 关闭；AC-8/AC-7 的部署侧 Access 段仍属 staging 证据。
- **任务仍保持 `in_progress`**：实现清单中 C1（§10.6 evaluate 接口）、C2（§6.2 首页跨市场风险图）、
  C3（§6.3 正常区间）、C9（产品 PRD 偏差回写）未完成。这些是产品 PRD 的页面/接口条款，
  不属于这 10 条 AC，但属于本任务的交付完整性，完成后再归档。

## Out of Scope

- 用户登录、个人订阅和付费墙；
- 多语言；
- WebSocket/SSE；
- 复杂 CMS、富文本编辑器；
- 原生 App。

## Dependencies

- `09-07-platform-foundation` 完成。
- `09-07-thesis-evaluation-publishing` 冻结 published/draft 语义和 Read Model 示例。
- 静态视觉骨架可与后端并行，但真实接口接入需遵守 contract freeze。
