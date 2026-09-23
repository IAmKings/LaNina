# Staging 告警与故障注入证据包

> 本文件把 PRD 的告警条件转换为 staging 演练的证据标准。它不配置 Cloudflare 告警、
> 不发送通知、不改变 Cron/来源/发布开关，也不构成任何生产操作授权。

## 适用边界与前置条件

- 仅限独立的 staging Worker、D1、R2、Access 身份与测试数据；不得复用 production 资源、
  凭据、预算或来源。
- `ENABLE_AUTO_PUBLICATION` 保持 `false`。故障演练的目标是验证发现和证据链，不能以自动发布
  制造或修复结果。
- staging account owner、数据/来源负责人、publisher、预算负责人和通知收件人须先分别书面批准：
  演练窗口、故障类型、可恢复步骤、测试身份、通知目的地和成本上限。
- 每次只演练一个故障；先保存演练前的 Worker version、最近可读 `briefDate`、公开页面截图和
  healthz/data-health 读取结果。任何 production 影响、私有字段泄露、无可恢复基线或授权缺失均立即停止。

## 告警矩阵

| 场景 | PRD 阈值 | 预期可观察信号 | 需由授权人执行的 staging 注入 | 必须保存的只读证据 | 恢复/停止判断 |
| --- | --- | --- | --- | --- | --- |
| Cron missing | 任一计划触发后 10 分钟仍无开始记录 | Workers Logs 中该 schedule 无 `handler`/`scheduledAt` 事件；对应监控规则告警 | 在已批准窗口暂时阻断**单个 staging** Cron 的执行路径，或使用平台批准的等价缺失触发方式 | 时间窗、期望 schedule、日志查询链接/截图、告警时间与接收记录、healthz/overview | 恢复后下一正常触发必须有结构化日志；若影响 production、Cron 目标不唯一或无法恢复，停止 |
| P0 source failure | 同一 P0 source 连续失败 3 次 | 三个 run 的 `sourceId`/`runId`、安全 `errorCode`；health 进入 `broken`；页面仍可读 | 仅对一个获批准的 staging 测试 source 注入可恢复失败；不得更改 production source 或绕过 health 状态机 | 三次 run 的 UTC 时间、日志筛选、data-health、公开页面截图、告警送达 | 后续一次成功恢复为 `healthy`；若影响其他 source/公开私有数据，停止并按恢复手册分流 |
| Daily delay | 北京时间 07:00（UTC 前一日 23:00）发布规则不满足或未发布 | 明确的 delayed decision、对应 cutoff/draft 状态、上一版 brief 仍可读、后台告警 | 使用已批准的 staging 测试数据使单一发布门禁不满足；不得打开自动发布或改写冻结 brief | `briefDate`、cutoff、decision/run ID、上一版 daily URL、页面“延迟”状态、通知记录 | 移除注入后仅重新验证正常决策；若历史 brief 不可读或出现部分公开，停止 |
| Public API 5xx | 5 分钟内 5xx 比率超过 1% | 边缘/Workers 指标中的 5xx 比率、脱敏 requestId、错误日志和告警 | 只通过批准的 staging 故障开关或隔离测试版本产生有限请求；不得对生产或真实用户流量注入 | 请求数量/窗口、5xx 比率、requestId、错误码、日志查询、告警时间；不得保存请求头、JWT 或正文 | 停止注入后 5xx 回到基线；若存在敏感日志、影响面不清或请求无法限流，停止 |
| 解析观测骤降 | 相对历史中位数下降 80% | source run 的观测计数、基线中位数、safe error/health 与告警 | 仅使用 fixture 或测试 source 返回经批准的低计数结果；不得篡改真实 snapshot 或历史 observation | sourceId/runId、当前计数、基线计算口径、日志/健康投影、告警记录 | 删除 fixture 后用正常 fixture 验证；若需要覆盖历史数据或无基线，停止 |
| 预算/用量 | D1、R2 或 Worker 使用量达到 70% 与 90% | 账户用量面板或批准的计量系统阈值告警 | 不通过人为消耗资源触发；由预算负责人在 sandbox/测试计量中演练规则或提供平台测试记录 | 环境、资源类型、阈值、计量时间窗、告警路由、预算负责人确认 | 70% 是预警、90% 是升级；若计量来源/环境不明确，记录为未验证而不是模拟消耗 |

## 通用证据字段与留存

每次演练使用一个事件号，记录：环境、演练场景、批准变更号、actor 角色、开始/结束 UTC、
Worker version、`requestId`/`runId`/`sourceId`/`thesisId`/`briefDate`（适用时）、预期阈值、
实际信号、告警发送与接收 UTC、通知目的地类型、日志查询链接、公开页面截图、恢复结果和决定人。
未知字段标记 `unknown`，不推测补填。

证据不得包含 Access JWT、Cookie、Authorization、API key、完整上游响应、R2 snapshot key、
个人邮箱或内部通知正文。链接应指向经权限控制的日志/工单；公开报告只保留脱敏摘要。

## 与三天 soak 的关系

- 故障注入演练**不计入**三天连续 soak。演练后须恢复已知良好 staging 基线，并重新保存基线证据。
- 三天 soak 每天在 06:30 和 07:00（Asia/Shanghai）后保存 source health、run ID、draft ID、
  published/delayed decision、页面截图、日志查询与告警状态。任何 critical failure 使连续计数归零。
- 告警规则已存在、告警成功接收、故障已定位、恢复成功是四个独立结论；缺任何一项都不得写为
  “告警演练通过”。

## 演练结束的只读核对

1. 读取 healthz、overview、data-health、受影响 thesis（如有）和最近已发布 daily brief；确认均不含
   draft、snapshot key、内部异常或凭据。
2. 以 Access viewer 读取后台运行记录，并在 Workers Logs 按事件号时间窗关联安全字段；不要执行新的
   写操作来“补救”证据。
3. 由通知收件人确认收到时间与场景匹配，由责任人确认恢复条件达成。任一项缺失则证据状态为
   `incomplete-external`。
4. 恢复、来源停用、thesis 撤回、Worker 回滚和 D1 处置遵循
   [恢复与回滚运行手册](./recovery-runbook.md)，不得以本文件取代其角色授权和停止条件。
