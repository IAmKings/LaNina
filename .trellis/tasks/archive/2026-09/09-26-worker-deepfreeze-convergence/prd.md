# worker 侧 deepFreeze 收敛

## Goal

批次三只收敛了 domain 层（internal/freeze.ts）；worker 侧仍有内联副本。另发现 cloudflare-thesis-change-reviews.ts:189 是浅冻结（仅 Object.freeze 顶层），与 deepFreeze 语义不同，需先确认是否有意为之。证据：research/2026-09-25-deep-analysis-findings.md「存储层」与批次三检查报告。

## Requirements

- R1 调查：列出 worker 侧全部内联 deepFreeze/Object.freeze 位置（adapters/storage ×5、daily-schedule.ts、thesis-change-reviews.ts 等，grep 为准），逐一判定深/浅语义
- R2 thesis-change-reviews 浅冻结：若有意（如性能/对象共享考虑）→ 保留并在共享实现中以显式命名区分（如 shallowFreeze/deepFreeze），注释声明决策；若无意 → 改为深冻结并作为已声明行为变化加测试
- R3 其余深冻结副本收敛到共享实现（可放 src/worker/ 或复用 domain/internal/freeze.ts——跨层 import 需评估，若 domain 不宜被 worker 复用则建 src/worker/internal/；按 backend spec 目录约定定）
- R4 零行为变化（除 R2 若判「无意」的显式声明项）：全部现有测试与快照零漂移

## Acceptance Criteria

- [ ] 浅/深冻结决策有书面结论并落入代码注释
- [ ] worker 侧无未收敛的深冻结副本（grep 验证）；浅冻结（如保留）显式命名
- [ ] 全量门禁绿：lint / typecheck（双配置）/ test / build / check:bundle / test:integration / test:security

## 约束

- 轻量任务 PRD-only；调查在任务内完成并写入交付说明；不动 src/domain、src/web
