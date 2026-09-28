# 暂缓种子阈值回填（等研究数值输入）

## Goal

完成 RUBBER-TH-01 / PALM-SEA-01 / MAIZE-SA-01 / SHIP-USEC-01 四条暂缓种子的数值阈值回填，使其方向按 D1 决策语义恢复 available。**硬前置**：研究负责人在填空件上给出阈值并签字（工程侧不代拟数字）。填空件与派生指标缺口清单已产出：`research/threshold-backfill-fill-in-sheet.md`。

## Requirements

### R1 回填准备（本任务当前阶段，已完成）
- 填空式签字件：每条种子给出候选规则形态（数值留空）、需要研究负责人提供的输入、签字行
- 派生指标工程缺口清单（两级）：L0 派生指标机制 / L1 降水距平与 USDA 派生计算（数据已在采集）/ L2 新源（MPOB、ACP）

### R2 回填实现（等签字后，本任务内继续）
- 按签字结果接入对应 P-工程项（L0/L1 为工程任务，L2 新源另走来源权利预审 + 适配器任务）
- 按 D3 任务既有约定实现数值规则：组合而非替换、`<前缀>-numeric-<后缀>` 命名、方向策略映射同步、单位逐字一致、容差 4×EPSILON、D1 守卫保留
- 对应种子方向恢复 available（阈值语义内）；快照 diff 逐条声明

### R3 决策门（gates）
- G1：研究负责人对填空件逐条签字（数值 + 候选选择）——未签字不实现
- G2：若选中 L2 新源候选（MPOB/ACP）：来源权利预审通过后才立适配器任务
- G3：若选中 L1 派生指标：距平基准期/基准分布定义需一并签字（如 WMO 1991-2020）

## Acceptance Criteria

- [ ] 填空件经研究负责人逐条签字
- [ ] 签字候选对应的派生指标工程完成并经评估管道消费（L0/L1）
- [ ] 四条种子（或签字落地的子集）方向在典型证据下恢复 available；其余维持 unavailable（既定语义）
- [ ] 快照 diff 逐条声明；全量门禁绿（lint / typecheck / test / build / check:bundle / test:integration / test:security）
- [ ] README/方法论如涉及方向判定表述同步

## 约束

- 工程侧不代拟研究数字；不越过 G1-G3 门槛
- 迁移只增不改；领域层纯函数无 IO；种子内容变化以签字为准
- L2 新源适配器遵循 adapter-base 基座与 source-ingestion 规范
