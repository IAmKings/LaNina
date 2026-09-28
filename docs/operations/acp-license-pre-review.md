# ACP（巴拿马运河管理局）来源许可预审

> 范围：仅 SHIP-USEC-01 数值规则所需的两项事实——`panama_daily_slots`（日配额）与
> `panama_max_draft_ft`（最大吃水）。审阅日期：2026-09-28（UTC）。
> 本记录只使用 ACP 第一方页面与本仓库既有调查（[ACP Spike](../sources/panama-canal-authority.md)、
> [来源发布登记册](source-release-register.md)）；它是发布前的证据整理，不是法律意见、合同或生产批准。
> 页面可访问不等于获得抓取、私有留存、派生或向终端用户再分发的权利。

## 结论边界

- **预审结论：当前不通过（`restricted` 维持）。** 两条签字规则（日配额 ≤24、吃水 ≤48 英尺）在本
  预审结论下**不能合法实现**：所需的自动收集、私有留存与派生公开展示均落入 ACP 书面授权范围，
  而该授权尚未取得。这一结论与登记册既有判定一致。
- **权利事实（第一方）：** ACP [使用条款](https://pancanal.com/en/terms-of-use/) 声明站点内容
  （信息、文档、报告、地图与照片）**为 ACP 财产**（© ACP 1998–2025）；以商业或营利为目的的复制、
  分发、传播、重制或发表**需要 ACP 事先明示授权**。条款未涉及自动化访问/抓取；robots.txt 的
  `Crawl-delay: 10` 是抓取礼节而非许可（Spike §Access）。
- **数据形态事实（第一方）：** 当前周期的配额/吃水数字只出现在**新闻稿自由文本**中
  （[2026-08 措施](https://pancanal.com/en/panama-canal-adopts-additional-measures-to-address-reduced-precipitation-in-the-canal-watershed/)、
  [09-05 吃水更新](https://pancanal.com/en/panama-canal-postpones-neopanamax-draft-adjustment/)——
  45→48→49→50 英尺的动态调整见
  [水资源专题](https://pancanal.com/agua/)）；结构化水位数据在第三方 AQUARIUS dashboard
  （[panama.aquaticinformatics.net](https://panama.aquaticinformatics.net/Data/Dashboard/1)），其
  使用条款独立于 ACP 站点。**不存在已知的安全结构化数据端点。**
- **登记册既有判定（第一方）：** [登记册](source-release-register.md) 对 ACP 的两行候选均为
  `restricted` / `COVERAGE_GAP`：「未许可前不复制 CSV/PDF 内容」「ACP 对自动收集、私有留存、
  派生、公开展示的书面授权」。
- **替代路径（见下）**：授权申请 / 人工逐条登记 / link-only 展示。三者都需要研究负责人决策；
  在作出决策并完成对应动作前，USEC 方向维持 unavailable（既定语义）。

## 一手证据与逐项判断

| 主题 | 事实（直接第一方来源） | 合理解释 | 尚需人工/法务确认 |
| --- | --- | --- | --- |
| 所有权与许可 | [使用条款](https://pancanal.com/en/terms-of-use/)：站点内容为 ACP 财产；无开放数据许可；© ACP 1998–2025。 | 「公开可访问」不构成许可；与本仓库其他 `allowed` 来源（NOAA CC0、World Bank CC BY）不同，ACP 无可援引的开放许可模板。 | 研究负责人若主张「事实投影/新闻编辑引用」例外，须自行确认该解释的边界（单点数字 vs 内容复制）。 |
| 商业/营利使用 | 条款：商业或营利目的的复制、分发、发表需 ACP「事先明示授权」。 | 本项目公开网站是否属「营利」存在解释空间；登记册的既有口径是不依赖该解释、以书面授权为准。 | 是否就本产品的非营利/研究性质向 ACP 取得书面确认（即使最终被归为非营利）。 |
| 自动化访问 | 条款未涉及自动抓取；robots.txt `Crawl-delay: 10`（Spike §Access）。 | 抓取礼节不是许可；自动轮询 + 私有留存 + 派生公开是登记册明列需书面授权的四项。 | 若走授权路线：请求须覆盖轮询频率、留存、派生、公开受众、署名与退出删除。 |
| 数字载体 | 配额/吃水数字在新闻稿自由文本（第一方引用见上）；结构化水位在第三方 AQUARIUS 系统；[统计页](https://pancanal.com/estadisticas/) 为历史统计而非当前限制值。 | 即使取得授权，从新闻稿抽取结构化值的可靠性是独立技术风险（值会动态调整：45→48→49→50）；需要 design 阶段评估「公告页结构稳定性」并保留 fail-closed。 | 授权范围是否覆盖「从新闻稿抽取数值」；或能否取得更稳定的数据通道（Spike §4 记载 Authenticated Operations API 宣称 JSON 但需账户/方案与条款）。 |
| 替代数据源 | 无已知的 ACP 之外官方一手来源（登记册：第三方航运数据商为 `restricted`，且替代源不能称为 ACP 一手事实）。 | 第三方引用 ACP 的二手数据不解决权利（权利不随转载转移）。 | 无。 |

## 替代路径（研究负责人决策）

| 路径 | 内容 | 对方向字段的影响 | 代价 |
| --- | --- | --- | --- |
| **1. 书面授权申请** | 按 [external-authorization-requests.md](external-authorization-requests.md) 模板向 ACP 发出来源权利请求（覆盖轮询、留存、派生、公开、署名、退出删除）；获准后走适配器任务 | 恢复 available | 周期取决于 ACP；新闻稿抽取的可靠性风险仍在（design 需评估） |
| **2. 人工逐条登记** | 比照 manual source runs 的形态：发布者把 ACP 公告中的配额/吃水**逐条人工录入**（每条带官方 URL、公告日期、署名），数值规则照常消费 | 恢复 available（录入时效=公告时效） | 权利解释需研究负责人确认（单点事实的人工编辑引用 vs 「复制内容」）；无自动化，公告后需人工动作 |
| **3. link-only 展示** | 按 2026-09-21 编辑引用先例，自动外链 ACP 公告页（不复制数值） | **不恢复**（无数值规则输入） | 不解决本任务目标 |
| **0. 维持现状** | 方向 unavailable（PRD「默认分化/待验证」的姊妹语义：运河约束未经一手数据证实前不判方向） | 维持 unavailable | SHIP-USEC-01 的事实链继续缺 ACP 环节 |

## 审核交接清单

- **来源权利审核（pending）**：按所选路径取得 ACP 书面授权，或对路径 2 的权利解释作出书面裁决。
- **产品/研究审核（pending）**：确认配额/吃水是 ACP 运营事实而非对本产品的结论；动态调整（如
  09-05 延后减吃水）必须向用户标注时效。
- **发布审核（pending）**：核查署名（「Fuente: Autoridad del Canal de Panamá」+ 官方 URL + 公告
  日期）、不背书文案、以及不复制公告正文（只投影两个数值事实）。

## 本任务的状态影响

按任务 PRD R1：预审不通过 → **本任务暂不进入适配器实现**；三条路径由研究负责人选择后才继续
（路径 1/2 选择后本任务重启，路径 3/0 则按 PRD 归档并记录替代路径）。签字数值（≤24 / ≤48）不因
预审结论失效——它们在任一路径解锁后直接适用。
