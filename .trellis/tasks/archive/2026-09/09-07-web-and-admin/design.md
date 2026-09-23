# Design — 公开网站与研究后台

## Read Models

页面只消费以下 typed projections：OverviewPage、ThesisPage、CategoryPage、ChangesPage、DataHealthPage、AdminRunsPage、AdminDraftPage。projection 在 Worker 内集中构建，前端不得重新计算 stage、confidence 或 freshness。

日期序列化为 UTC ISO，前端统一显示 Asia/Shanghai。所有数值带 unit 和 quality；可空字段显式 `null`，不使用缺字段表达未知。

## Routing

Static Assets 处理已构建前端；`/api/v1/*`、`/api/admin/*` 和 `/feed.xml` 先进入 Worker。SPA navigation 使用 Static Assets 的 SPA fallback。

公开路由采用 60 秒或产品 PRD 指定的 Cache-Control；发布后更新 cache version key。历史日报 immutable。

## UI Composition

- Home：ENSO header、top changes、thesis grid、stage map、health summary。
- Thesis：verdict header、evidence split、transmission stages、lazy charts、version timeline、sources。
- Category：共享 category layout，不复制三套逻辑。
- Changes/Health：可筛选表格与移动卡片共享同一 projection。
- Admin：runs、draft diff、publish/withdraw；不引入通用 CMS。

ECharts 通过动态 import。颜色以 token 驱动，同时使用 label/icon，不用颜色单独编码方向。

## Admin Security

Worker 验证 Access JWT signature、issuer、audience、expiry 和 email/group mapping。Frontend route guard 只改善体验，不构成授权。写接口使用 expected version 防止并发覆盖。

## Error Handling

页面级错误不会清空已缓存 published data。stale 数据显示 banner 和截止时间。图表某一 series 失败只影响该图，并提供文本状态。

## SEO and Accessibility

公开页面有唯一 title/description/canonical、sitemap 和结构化更新时间。核心图表提供数据表/摘要。筛选状态写入 URL query 以便分享和返回。
