# 质量、安全与生产发布

## Goal

验证前四个子任务形成的完整产品满足产品 PRD、许可、安全、可靠性和运维要求，并以可回滚方式完成 staging 演练和生产发布。

## Requirements

- 执行父任务 AC-01–AC-15 和产品 PRD §14 全部场景。
- 验证 D1 migration、索引、R2 隐私、Access、日志脱敏和来源 allowlist。
- 审核所有 production-enabled 来源的许可台账与公开字段。
- 配置 Workers Logs、source/Cron/daily/API/budget 告警。
- 建立 D1 恢复、daily brief R2 export、Worker rollback 和 source disable runbook。
- 在 staging 连续三天完成 06:30 草稿与 07:00 发布/延迟流程。
- 生产资源创建、Paid 选择、域名和部署均需显式账户授权。
- 发布后进行烟雾测试并观察至少一个完整 Cron 周期。

## Acceptance Criteria

- [ ] lint、typecheck、unit、contract、integration、E2E、build 全部通过。
- [ ] 产品 PRD §14.3 五个端到端场景通过并留存证据。
- [ ] 关键 D1 query plan 使用索引；容量假设下无明显全表扫描。
- [ ] R2 不能匿名访问；公开接口无 snapshot key/内部 error/draft 泄露。
- [ ] viewer/editor/publisher 权限矩阵通过。
- [ ] 每个上线来源的 redistribution 状态经人工审核。
- [ ] 故意触发 source failure、Cron missing、daily delay 和 API 5xx 能被发现。
- [ ] D1/Worker 恢复或回滚演练成功，不丢失最近已发布日报。
- [ ] staging 连续三天流程成功。
- [ ] 生产预算和付费选择有明确记录；未授权时不创建生产资源。
- [ ] 发布后首页、详情、后台和 scheduled smoke 均正常。

## Out of Scope

- 新产品功能或新来源；
- 用扩大范围的方式修复发布阻塞；
- 购买商业数据或 Cloudflare 计划；
- 长期 SRE 平台。

## Dependencies

- `09-07-platform-foundation`、`09-07-source-ingestion`、`09-07-thesis-evaluation-publishing`、`09-07-web-and-admin` 均完成各自质量门禁。
