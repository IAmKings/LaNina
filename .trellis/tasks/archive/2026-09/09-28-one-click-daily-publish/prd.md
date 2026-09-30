# 每日判定一键发布（全链路）

## Goal

批量发布草稿版本+记录审核+模板生成文案+直接提交简报的单按钮链路；预检扩展 target 文本事实与上期简报；发布契约零改动

## Requirements

（已批准计划全文，2026-09-28）

**服务端（仅扩展预检，发布契约零改动）**：findCutoffVersions 增选 direction/stage/confidence/summary；AdminDailyTargetModel 增四字段；AdminDailyPageModel 增 previousBrief（headline/summary，可空）。

**客户端**：新按钮「一键发布今日判定」串联四步——①批量发布草稿版本（失败即停）②记录 pending reviews ③重取预检 ④模板生成 headline/summary 直接提交；模板纯结构化事实（禁止因果表述，PRD:985/932）；reason 默认模板；topChanges 默认空；互斥纳入 adminDailyControlsBusy；结果面板逐步状态。

**明确不做**：topChanges 自动选材（changes 管道为空）；发布契约改动；NLG 文案。

## Acceptance Criteria

- [ ] 一键链路四步串联、任一步失败即停并展示步骤级错误
- [ ] 模板生成有/无上期两态、差值陈述、长度上限
- [ ] 发布契约零改动（既有契约/门禁测试零漂移）
- [ ] 全量门禁绿

## Notes

- Keep `prd.md` focused on requirements, constraints, and acceptance criteria.
- Lightweight tasks can remain PRD-only.
- For complex tasks, add `design.md` for technical design and `implement.md` for execution planning before `task.py start`.
