# e2e 接入 axe 自动无障碍扫描

## Goal

前端审查发现：可访问性测试（color-contrast、public-accessibility）覆盖样式与语义层，但 e2e 三个 spec 没有 axe 自动扫描。接入 @axe-core/playwright 使公开页的无障碍回归进入既有 e2e 门禁。

## Requirements

- R1 新增 @axe-core/playwright devDependency
- R2 在现有 e2e spec（e2e/ 目录 3 个）中对关键公开页注入 axe 扫描：首页、/rubber、/changes、/data-health、/methodology、/theses/:slug（按现有 spec 结构自然融入，不新建大而全的扫描 spec）
- R3 违规处置策略：首次运行如实记录既有违规为基线（写入 e2e/axe-baseline.md 或等效），断言「不引入基线之外的新违规」；critical/serious 违规如有，列出并单独评估，不静默放行
- R4 CI 的现有 e2e 步骤自动获得覆盖，不新增 job

## Acceptance Criteria

- [ ] npm run test:e2e 通过且含 axe 断言；基线文件存在且与实际一致
- [ ] CI 无需结构性改动（或仅最小调整）即覆盖
- [ ] lint / typecheck / build / check:bundle 绿

## 约束

- 轻量任务 PRD-only；axe-core 只进 devDependencies；不动 src/ 生产代码（除非修复扫描出的真实违规，那也需先列入交付说明）
