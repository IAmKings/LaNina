# Design — 质量、安全与生产发布

## Verification Layers

1. Static：lint、typecheck、dependency/security review。
2. Module：domain、ingestion、evaluation、publishing、read model。
3. Contract：每个 external adapter 与 public/admin response。
4. Integration：D1/R2/Worker local round-trip。
5. E2E：浏览器、Access、scheduled、publication。
6. Operational：alerts、backup、restore、rollback、budget。

测试结果按父任务 AC 编号映射，避免“测试通过”但需求漏测。

## Staging Soak

三天期间禁止修改 thresholds 或跳过失败来源来制造成功。每天保存 source health、run IDs、draft ID、published/delayed result、页面截图和日志查询。任何 critical failure 重新开始连续三天计数。

## Production Change Shape

1. 创建/确认生产 D1/R2/Access/secrets/Cron；
2. 执行 additive migrations；
3. 部署自动发布关闭的 Worker；
4. 运行手动采集和只读烟雾；
5. 发布种子/首版内容；
6. 开启 Cron，首月保持人工发布；
7. 观察完整周期后宣布上线。

## Rollback Decision

- 内容错误：撤回 thesis version。
- 单来源错误：disable source。
- Worker 回归：Cloudflare version rollback。
- D1 corruption：暂停写入并使用恢复能力；不得为一般内容错误回滚整库。
- 许可问题：立即隐藏相关公开值/快照链接，保留受限审计数据或按要求删除。
