# 恢复与回滚运行手册

> 适用范围：ENSO 市场影响监测的 staging 与 production 事故处置、演练和恢复验证。
> 本手册不授予任何 Cloudflare、D1、R2、Access 或发布权限，也不包含远端变更命令。

## 0. 不变规则与证据包

- 恢复目标：公开页面在事故确认后 **2 小时内**恢复；最近一次已发布的每日判定不得丢失。
- 内容错误只撤回错误的 thesis version；单一来源错误只停用该 source；Worker 回归只回滚 Worker
  version。一般内容错误不得回滚整个 D1 数据库。
- 历史 daily brief 按冻结版本读取，不得改写、覆盖或以新版本替换；撤回后仍须保留对应历史
  `briefDate` 的可读性。
- 自动发布默认关闭。事故、恢复和演练期间保持 `ENABLE_AUTO_PUBLICATION=false`；不得以恢复为由打开它。
- production 的资源、备份/恢复点、Worker versions 与 Access 身份均须由相应账户所有者另行授权。
  staging 的授权不等同于 production 授权。

每个事件建立一个不含密钥、JWT、原始快照或个人数据的证据包，至少记录：环境、事件号、
`requestId`、`runId`、`sourceId`、`thesisId`、thesis version、`briefDate`、全部 UTC 时间戳、
actor、reason、Worker version、只读 URL、日志检索链接/筛选条件、页面截图链接、导出对象路径和
校验信息（如可见）。未知字段写 `unknown`，不得猜测或补填。

可用的只读入口如下；将 `<approved-origin>` 和日期替换为已获授权的实际值：

- `GET https://<approved-origin>/api/v1/healthz`：服务与版本健康证据。
- `GET https://<approved-origin>/api/v1/overview`、`/api/v1/data-health`：公开页面和脱敏来源健康证据。
- `GET https://<approved-origin>/api/v1/theses/<slug>`：当前公开 thesis 证据。
- `GET https://<approved-origin>/api/v1/daily/<YYYY-MM-DD>`：已发布的冻结 daily brief 证据。
- 受 Cloudflare Access 保护的 `GET https://<approved-origin>/api/admin/runs`：viewer 只读运行记录。
  不得把访问令牌、完整请求头或私有错误内容复制到证据包。
- 已获只读授权的 Cloudflare 控制台：Worker version/deployment history、Workers Logs、D1/R2
  的对象或备份元数据。日志只筛选本事件时间窗及结构化字段 `requestId`、`handler`、`sourceId`、
  `runId`、`thesisId`、`durationMs`、`outcome`、`errorCode`；不要导出原始请求体或密钥。

## 1. 事件分流与证据保全

### 只读检查

1. 记录发现时间（UTC）、告警来源、影响环境和影响的公开 URL；立即读取 healthz、overview、
   data-health，以及受影响的 thesis 或 daily brief URL。
2. 用 Access viewer 身份读取 `/api/admin/runs`；按时间窗关联 `runId`、`sourceId`、状态和安全错误码。
3. 在 Workers Logs 以事件时间窗和上述结构化字段检索，保存检索链接、结果数量和截图；不要保存
   原始快照、SQL、Access JWT 或上游响应。
4. 判断事件类别：内容错误、单来源错误、Worker 回归、疑似 D1 损坏、许可/隐私问题，或未分类。
   同时读取最近一个已发布 `briefDate`，作为“不得丢失”的基线。

### 受权写操作

本分流阶段没有默认写操作。需要改变公开内容、来源、Worker、数据库、Cron、Access 或任何 flag 时，
必须先转入下列对应流程。

**停止点与升级：** 发现草稿/私有字段泄露、密钥或 Access 令牌暴露、未知 Worker version、无法确认最近
已发布 daily brief，或无法归类为上述类别时，停止所有变更；由 Cloudflare account owner、数据/来源
负责人和 publisher 共同决定后续处置。许可或隐私问题还须通知许可负责人。

## 2. 单一来源停用与恢复启用

### 只读检查

1. 以 `/api/v1/data-health`、`/api/admin/runs` 和 Workers Logs 确认只有一个 `sourceId` 受影响，保存
   连续失败次数、相关 `runId`、UTC 时间、`errorCode`、来源合同/许可链接和截图。
2. 确认该 source 的错误没有造成公开私有数据泄露，也没有要求修改已经发布的 thesis；若有内容错误，
   同时走第 3 节。
3. 确认最近已发布 daily brief 可由 `/api/v1/daily/<briefDate>` 读取。不得用手动运行接口替代停用操作。

### 受权写操作

当前应用没有“停用/启用 source”的后台 HTTP 接口。来源所有者提出包含 `sourceId`、原因、预期时长和
恢复条件的变更记录后，**Cloudflare account owner 或获委派的生产数据配置负责人**才可在已批准的控制面
完成 source enabled 状态的变更；必须保留 actor、reason、前后状态和 UTC 时间。

**停止点：** 在写入前再次核对环境、`sourceId` 和许可状态；如目标不是单一来源、来源合同不明、会影响
其他来源，或没有来源所有者批准，停止。不得修改 Cron、自动发布或其他 source 来“补齐”数据。

恢复启用前，来源所有者须书面确认上游/合同问题已经解决；获授权的 editor 可在单独批准下运行一次受控
采集并记录 `runId`。只有该只读结果正常、来源健康可见、每日门禁结果未被绕过时，配置负责人才能恢复
启用。仍保持自动发布关闭。

## 3. 错误 thesis version 撤回

### 只读检查

1. 从公开 thesis URL 和 Access viewer 可见的审核页面确认 `thesisId`、当前公开 version、受影响
   `briefDate`、错误描述和链接证据；保存撤回原因建议及截图。
2. 读取该 `briefDate` 的 `/api/v1/daily/<YYYY-MM-DD>`。daily brief 是冻结历史，不应因 thesis 撤回而
   被重写；将撤回前的响应、`dataCutoff` 和读取 UTC 时间写入证据包。
3. 核对存在可恢复的较低 published version；若没有，记录“撤回后无前版可恢复”，不要临时编辑旧内容。

### 受权写操作

只有具有 Cloudflare Access `publisher` 角色的 **publisher**，并且有研究负责人对 `thesisId`、version 和
reason 的明确批准，才可通过已部署后台的撤回流程执行该 version 的 withdraw。系统语义是仅将当前版本
标记为 withdrawn，并恢复最近的较低 published version；不删除审计记录。

**停止点：** 提交前重新核对环境、版本、actor、reason 和预期恢复版本。若存在版本冲突、目标不是当前
公开版本、错误涉及多个 thesis、daily brief 读取异常，或 publisher/研究负责人任一方未批准，停止并升级。
不得修改 historical daily brief、直接编辑 D1 历史行或开启自动发布。

操作后以只读方式再次读取公开 thesis、overview、受影响 daily brief 和后台审核视图，记录响应时间、
requestId（如错误响应产生）、actor、transition/audit 证据链接和截图。若公开页未在缓存策略允许的窗口内
反映结果，转入第 4 节而不是重试写入。

## 4. Worker version 回滚

### 只读检查

1. 在已获只读授权的 Cloudflare 控制台记录当前 Worker deployment/version、最近已知良好 version、
   各自 UTC 时间、变更摘要和关联发布证据；以 healthz 读取当前应用版本。
2. 读取首页、受影响 API、一个 thesis URL 和最近 `briefDate`；在日志中以 `requestId`/`handler`/`errorCode`
   确认是 Worker 回归而非来源或 D1 损坏。
3. 核对目标版本与当前 D1 migration 兼容。现有迁移采用 additive-first；不能假设回滚 Worker 可以撤销
   数据或 schema。

### 受权写操作

只有 **Cloudflare account owner**（或其书面委派的 release owner）可在获批准的生产变更窗口中，将 Worker
切换到已记录的已知良好 version。写操作前必须记录目标 version、当前 version、环境、actor、reason 和
回滚决定人；本手册不提供控制台步骤或远端命令。

**停止点：** 若没有明确已知良好 version、目标 version 未经过 staging、D1 兼容性未知、最近 daily brief
无法读取，或变更窗口/账号授权缺失，停止。不得借 Worker 回滚回退整库 D1、覆盖 R2 对象或启用 Cron/
自动发布。

回滚后立即只读检查 healthz、首页、受影响 API、后台只读 runs 和最近 daily brief；持续观察日志与错误率。
若公开页面未在 2 小时目标内恢复或 latest published daily brief 不可读取，升级到第 6 节。

## 5. Daily brief 不可变导出核验

### 只读检查

1. 记录 `briefDate`，读取 `/api/v1/daily/<YYYY-MM-DD>` 并保存响应的取得 UTC 时间、`dataCutoff`、
   methodology version、公开内容摘要和截图。不得把私有 freeze key、版本 ID 或内部快照字段写入公开证据。
2. 经 R2 只读权限由 **Cloudflare account owner 或 backup owner** 查看对应导出元数据。产品约定的对象路径为
   `exports/daily/<yyyy>/<mm>/<dd>/brief.json`；记录对象路径、可见的创建时间、大小和校验信息（若平台提供）。
3. 对比导出所属日期与 `briefDate`，并确认它对应同一次已发布内容；若没有授权读取 R2，记录为
   `unverified-external`，不能声称已核验。

### 受权写操作

常规核验没有写操作。若对象缺失、无法读取或与公开 daily brief 不一致，**停止**；不得手工修改历史 brief
或覆盖 R2 对象。只有 Cloudflare account owner、backup owner 和 publisher 共同批准的独立恢复/导出变更
才可创建或恢复导出，并须先定义其不可覆盖、可审计的路径与验证标准。该变更完成后重新执行本节只读核验。

## 6. D1 恢复决策

### 只读检查

1. 用第 1 节证据判断是否为存储损坏：跨多个无关读取失败、D1 错误持续、已发布 daily brief 不能读取，
   或已获只读授权的 D1/备份元数据显示异常。记录时间窗、requestId、Worker version 和最近可读的
   `briefDate`。
2. 内容有误、单一来源失败、单个 thesis version 错误、缓存延迟或 Worker 代码回归都不是 D1 恢复理由；
   分别使用第 2、3 或 4 节。
3. 由 backup owner 只读核对可用的 D1 Time Travel/导出恢复点、恢复点 UTC 时间、覆盖范围和最近 daily
   export 元数据。没有恢复点或恢复点晚于最近已发布 daily brief 时，停止并升级。

### 受权写操作

仅在确认 D1 storage corruption 后，**Cloudflare account owner、D1/backup owner 和事故负责人**共同书面
授权恢复计划。计划必须指定隔离/暂停写入策略、目标恢复点、验证环境、actor、reason、回退方案，以及如何
保留最近已发布 daily brief。恢复应优先在 staging 或隔离副本验证；本手册不包含任何 D1 restore 命令。

**停止点：** 任何一项缺失即停止：损坏证据、三方授权、可验证恢复点、immutable daily export、已记录
Worker version、恢复后验收计划。不得为普通内容修正执行整库恢复，也不得删除 audit 或 R2 原始证据。

恢复后读取 healthz、overview、代表性 thesis、data-health 和最近 `briefDate`；由 backup owner 保存恢复点
与验证链接。若结果不一致，保持写入暂停并升级，不得反复覆盖恢复点。

## 7. 操作后 smoke 与观察

### 只读检查

在每种处置后，以事件证据包中的 approved origin 执行并记录以下只读检查：

1. healthz、首页、data-health、受影响 thesis 和最近 daily brief 均可读取；确认公开响应没有 draft、
   snapshot key、内部错误或 Access JWT。
2. Access viewer 读取 `/api/admin/runs`；相关 `runId`、状态、UTC 时间和安全错误码与事件记录一致。
3. Workers Logs 的 `requestId`、`handler`、`outcome`、`durationMs`、`errorCode` 没有持续异常；保存筛选链接。
4. 确认最近发布 brief 的公开响应仍与第 5 节导出核验对应。观察到恢复、证据完整和责任人签字前，不宣布
   事故关闭。

### 受权写操作

本步骤不包含默认写操作。若 smoke 失败，停止关闭事故，回到相应流程；不得以重启 Cron、打开自动发布、
清空缓存、改写 D1/R2 或重发发布请求作为未授权“修复”。任何后续变更仍须相应的 account owner、
source owner 或 publisher 授权及其流程停止点。

## 8. 仅限 staging 的演练清单

演练不得使用 production 资源、生产来源凭据、生产 Access 身份、付费计划变更或真实生产数据。开始前，
**staging account owner**、**staging data owner**、**publisher** 和 **backup owner** 分别确认独立资源、
测试数据、演练窗口及可恢复性；自动发布保持关闭。

### 只读检查

- 记录 staging origin、当前 Worker version、最近已发布测试 `briefDate`、可读的 R2 导出元数据、D1
  恢复点元数据和四类角色的授权证明。
- 阅读 healthz、overview、data-health、一个 thesis、daily brief 与 Access viewer 的 admin runs；建立
  演练前截图和 UTC 基线。
- 确认 staging 证据包字段齐全，且所有操作可追溯到 actor、reason、requestId/runId（如有）。

### 受权写操作

在逐项、可恢复且书面批准的 staging 窗口内演练：单 source 停用/恢复、错误 thesis version 撤回、Worker
version 回滚、daily export 只读核验，以及仅在确认 storage corruption 的前提下的 D1 恢复验证。每一步只由
对应 source owner、publisher、staging account owner 或 backup owner 执行，并先达到对应章节的停止点。

**停止点：** 任一步影响到 production、缺少独立 staging 恢复点、最新测试 daily brief 无法保留、Access
角色不明确、自动发布被开启，或证据包缺失时，立即停止演练并恢复到演练前的已知状态。演练失败不计入
三天 staging soak；修复并重新建立连续三天证据。

