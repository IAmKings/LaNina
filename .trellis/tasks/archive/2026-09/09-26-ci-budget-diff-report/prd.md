# CI 输出首屏预算当前值与 diff

## Goal

前端审查 O4：首屏预算余量仅约 10-12KiB（239.5/250），但 check:bundle 的输出/CI 日志不展示当前值与余量的趋势可见性，破线前不可见。检查器已返回 bytes（initial-client-js-budget.mjs:42-46），缺的是呈现。

## Requirements

- R1 scripts/check-initial-client-js-budget.mjs 输出增强：当前字节、上限、余量、占用百分比（现有输出已是单行——扩展为含余量与百分比的明细；保持超限 exit 1 语义不变）
- R2 CI：验证 .github/workflows/ci.yml 的 check:bundle 步骤输出可见（GITHUB_STEP_SUMMARY 或 stdout 均可，选最小改动）
- R3 README「验证」节的 check:bundle 描述同步
- R4 不改预算阈值本身（250KB 上限是既定门禁）

## Acceptance Criteria

- [ ] 本地 npm run check:bundle 输出含当前/上限/余量/百分比；超限 exit 1 不变
- [ ] CI 日志可见预算明细；lint / typecheck / build 绿

## 约束

- 轻量任务 PRD-only；只动 scripts/ + 可能的 CI yaml 一行 + README；不动 src/
