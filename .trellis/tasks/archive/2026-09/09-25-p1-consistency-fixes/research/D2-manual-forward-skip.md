# 决策单 D2：人工跨级确认（manual forward skip）端到端死特性

签字：KingsLZ（2026-09-26 会话确认）

## 现状与证据

`stage-gate.ts:94-101`：`eligibleIndex > previousIndex + 1` 且传入 `manualConfirmation` 时输出 `manual_forward_skip`、`manualConfirmationApplied=true`。

但两条下游管道都不可能让它产生草稿：
1. `direction-confidence.ts:443-445` 见到 `manualConfirmationApplied=true` 直接判边界失败（「只携带可伪造的布尔值，缺少可校验的具名人工确认契约」）；
2. `direction-confidence.ts:446-458` 重建 `evaluateStageGates` 时不传 `manualConfirmation`，即使删掉 1 的检查也会 mismatch；
3. `thesis-draft.ts:209-211` 再拒一次；链路终点 `daily-schedule.ts:264-271` 返回 `DIRECTION_UNAVAILABLE`。

两条管道的测试各自验证了对立结论（stage-gate.test.ts:90-147 验证它能推进；direction-confidence.test.ts:370 验证它被拒）。错误信息承诺的「可校验的具名人工确认契约」从未实现。

## 选项

| 选项 | 内容 | 优点 | 代价 |
|---|---|---|---|
| A | 实现签名契约：`StageGateResult` 携带具名 `StageGateManualConfirmation` 载荷（confirmedBy/reason/boundCutoff），validateStageResult 校验其与重建结果一致 | 保留跨级能力 | 需要跨 admin 路由→评估管道→领域层三层的载荷传递与信任设计；首月人工发布下无真实使用场景 |
| B（推荐） | 删除 stage-gate 的 `manualConfirmation` 分支（`manual_forward_skip` 不再可达）；跨级推进统一走既有 admin 高风险审核流程（`/api/admin/thesis-versions/:id/review`，README 已文档化） | 消除「阶段结论与评估结论永远不一致」的陷阱；评估管道的拒绝分支成为不可达死代码一并清理；与首月人工发布现实一致 | 理论上丧失「一次评估内跨级」能力——但该能力当前就是不可达的，删除不损失任何现有行为 |

## 推荐

**B**。现有 admin review 流程已覆盖「人工确认高风险转场」的需求（方向变化、阶段跨两级、置信度 ≥20 都走它）；manualConfirmation 是一条从未打通的平行通道，留着即是陷阱（未来任何人接线都会撞上评估层拒绝）。

## 影响面

- `stage-gate.ts`（删除分支与 `StageGateOptions.manualConfirmation`）、`direction-confidence.ts`（删除 :443-445 与重建参数）、两处测试对齐、`thesis-draft.ts:209-211` 的防御分支可保留（纵深）。
- admin 路由无变化（review 流程不动）。

## 回滚

单提交回滚；无 schema 依赖。
