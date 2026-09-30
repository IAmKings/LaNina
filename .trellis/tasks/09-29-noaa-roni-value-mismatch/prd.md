# NOAA RONI 适配器数据正确性缺陷（入库值与 CPC 官方表不符）

## Goal

staging 入库 RONI 序列（09 月 −0.52，平滑下降）与 CPC 官方 2026 行（AMJ +0.5→MJJ +1.0→JJA +1.4）严重不符，疑读取错误表格行/年份对齐；导致 ENSO 签字阈值被错误评估为未命中。P1 数据完整性

## Requirements

### 现象（2026-09-29 staging 实测，P1 数据完整性）

- CPC 官方 RONI 表 2026 行：DJF −0.9 / JFM −0.8 / FMA −0.4 / MAM 0.0 / **AMJ +0.5 / MJJ +1.0 / JJA +1.4**（上升段，与研究报告「很强厄尔尼诺发展」一致；行止于 JJA）
- staging 入库序列（quality: 旧月 verified、近两月 provisional，说明适配器自认为解析正确）：04-01 +0.42 / 05-01 +0.18 / 06-01 −0.11 / 07-01 −0.35 / 08-01 −0.48 / 09-01 −0.52——平滑下降，**形态近似官方 2024 年（拉尼娜年）的下降段**
- 后果：ENSO 签字阈值规则（RONI ≥ +0.5）被错误评估为未命中 → ENSO 方向 unavailable → 每日评估零草稿 → 一键发布在模板步 fail-closed（该行为本身正确）

### R1 根因调查
- 读 noaa-roni.ts 的季节→observed_at 映射与表格行/列解析，对照 CPC 页面真实 HTML（页面格式可能已变化且 SCHEMA_DRIFT 未触发——解析结构合法但语义错位）
- 裁决三种假设：年份行错位 / 列（ONI vs RONI）混读 / 月-季映射错位
- 同时核对本地库更早的历史行是否同样错位（影响已发布版本的证据与已冻结简报的评估口径）

### R2 修复与回归
- 修复解析并让 contract fixture 用真实页面形态；新增「2026 行逐季数值」的对照测试（防再次语义错位）
- 评估已入库错误行的处置：错误观测的修订/失效策略（不得静默覆盖历史；按观测修订语义追加 corrected revision 并标注）
- 影响面声明：ENSO 证据、已发布版本的评估输入、派生指标（无）

### R3 验证
- staging 采集一次真实数据，入库值与 CPC 官方表逐季一致
- ENSO 数值规则（RONI ≥ +0.5）按真实值命中 → 方向 available → 每日评估产出草稿
- 全量门禁绿

## 约束
- fail-closed 不变：解析不确定时不产出
- 历史行不静默改写；更正走观测修订语义并声明
- 若裁决为「页面格式变化」，先固化新形态再修

## Acceptance Criteria

- [ ] 根因裁决成文（年份行错位/列混读/月季映射，三者之一 + 证据）
- [ ] 修复后 staging 真实采集入库值与 CPC 官方表逐季一致
- [ ] 错误历史行的更正按观测修订语义落库并声明
- [ ] ENSO 数值规则按真实值命中，方向恢复 available；全量门禁绿

## Notes

- Keep `prd.md` focused on requirements, constraints, and acceptance criteria.
- Lightweight tasks can remain PRD-only.
- For complex tasks, add `design.md` for technical design and `implement.md` for execution planning before `task.py start`.
