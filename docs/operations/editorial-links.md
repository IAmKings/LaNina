# 编辑引用（link-only）政策：Drewry / Xeneta / Sea-Intelligence / SSE

> 覆盖范围：虽然没有商业合同而无法自动采集数值的三个商业来源，
> 产品可以在详情页以**只链接不取值**的方式自动展示它们的**公开页**。
> 本文与其链接来自仓库内 [SPIKE 的实测条款](../sources/shipping-route-markets-controls.md)，
> 不是法律意见。

## 一、为什么"只展示链接"是被允许的（且零成本）

PRD §13.2 规定："商业行情未取得许可时，只展示**链接**、允许的延迟值或研究人员的方向判断"。
超链接本身就是 web 标准的引用方式，不构成对数据内容的复制或抓取：

| 约束 | 适用性 |
|---|---|
| 抓取 / 解析 / 存储 / 机器提取 / 定期修改方向 | ❌ 禁止（违反来源 ToS、破坏注册块纪律） |
| 从固定 URL **手工**读取当期值并写进 evidence | ✅ 编辑逐条引用（每个版本可多次登记） |
| 页面上**直接自动跳转的静态链接**（`evidence.citation_url`） | ✅ 无需抓取对方；一次写入，无需定期维护 |

## 二、各家 link 的落点与边界

| 来源 | 合适的落地页（link-only） | 禁止事项 |
|---|---|---|
| Drewry WCI | [容器指数周评估页](https://www.drewry.co.uk/container-insight/world-container-index-assessment-for-week)| 禁止自动提取指数值、历史价格或外推 |
| Xeneta XSI-C | [XSI-C 公开面](https://xsi.xeneta.com/)（当前值可人工署名引用） | 同上；订阅/索引用途须另行获得 |
| Sea-Intelligence GLP | [GLP 新闻稿页](https://sea-intelligence.com/)（人工署名引用全球/承运商头条） | 月度 lane-level 数据主办方保留 |
| SSE SCFI/CCFI | [SSE Institute 主页](http://en.sse.net.cn/)（链接性引用，不复写数值） | ⛔ "for perusal only" |
| Freightos/Baltic FBX | [FBX 公布页](https://fbx.freightos.com/) | 禁止 API、投资模型使用与再分发 |
| UNCTAD LSCI/PLSCI | 官方统计 SDMX 页（免费署名） | 结构代理，非运价 |
| Eurostat maritime | 官方 SDMX 页（免费署名） | 结构代理，非运价 |

## 三、落地方式

1. **路由**：`evidence.citation_url` 已是正式字段——所有 demo 种子（TEST ONLY）已经用
   真实页面链接替换了占位 `example.test`；编辑部工作流中 editor 每次评审草稿时
   逐条更新为最新版引用即可（不需要按周人工发布）。
2. **hidden**：link-only 的发布永远不改 `dataCoverageNotes` 中的覆盖不足标签；
   也**不会**进入 observations 表（不生成任何"机器适配器路径"）。
3. **红线**：无论展示哪条 link，**页面可以"看到值而无权取值"**——那是来源方的权利边界，
   不能因为展示了一个页面链接就绕过；specifically,自动化抓取没有写进任何文件。
