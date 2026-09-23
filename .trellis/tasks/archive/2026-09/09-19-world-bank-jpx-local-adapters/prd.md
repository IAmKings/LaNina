# 零成本数据源落地：World Bank 月度与 JPX 当日 CSV

## Goal

把 A-Ⅱ 层采购计划变成可运行代码：实现 World Bank Pink Sheet（月度 RSS3/TSR20）与
JPX/OSE 当日结算价 CSV 两个**零成本**来源的适配器，纳入本地采集管线（`local:collect`），
让免费阶梯先在本机得到端到端验证；生产/staging 启用仍严格等待登记册三项签署。

## Requirements

- **R-01 来源登记（默认停用）**：`seeds/0006_world_bank_jpx.sql` 登记 2 个来源 + 4 个指标
  （WB RSS3/TSR20 月度 USD/kg；JPX RSS3/TSR20 日度 JPY/kg），均 `enabled=0`、`public=0`；
  WB `redistribution='allowed'`（数据集级 CC BY，exact-value 复核待记录）、JPX `redistribution='unknown'`
  （Spike：无许可即禁商用收集）。
- **R-02 本地 TEST ONLY 启用**：`seeds/9002_test_only_local_free_sources.sql` 仅本地把两个来源
  `enabled=1` + 指标 `public=1` + `next_due_at` 过期，并接入 `db:reset:local`；CI 种子集不受影响。
- **R-03 World Bank 适配器**：单次有界 GET（Last-Modified 条件请求；587KiB < 1MiB 快照上限）；
  最小 XLSX 解析器（ZIP central directory + DecompressionStream('deflate-raw')）定位
  `Monthly Prices` 工作表 → 动态按表头文本找 `Rubber, RSS3` / `Rubber, TSR20` 列 →
  行标 `YYYYMnn` → 月末 observedAt；窗口 ≤24 个整月；缺失 `…` 跳过；结构性漂移抛
  `SCHEMA_DRIFT`。
- **R-04 JPX 适配器**：两跳抓取（settlement 页 → 抽取 `rb_e\d{8}\.csv` 链接 → 取当日 CSV）；
  实测整单 CSV ≈ 3.7MiB/42k 行 → 本适配器响应上限放宽为 4 MiB 并注释实测依据；
  按 `Underlying Name == Rubber(RSS3)|Rubber(TSR20)` 过滤，每合约月一条观测（不拼接连续合约），
  每日仅取**最近到期合约**（v1 就近选择规则，标记 warning）；结算价可能被 JSCC 修订 →
  quality='provisional'；观测日期取 CSV 文件名的业务日。
- **R-05 接线与红线**：registry 注册两个 key（`isApprovedSourceAdapterKey` 同步）；
  `live-smoke-targets` 增加两个 CodeOwnedSourceTarget（手动运行可用）；staging/生产启用
  门槛不变——必须先过登记册"三项签署"。
- **R-06 测试**：适配器 contract 测试全部用**仓库内合成 fixture**（自构造 STORED-XLSX / CSV
  文本），不提交任何第三方响应体或数据行；测试断言解析锚点、窗口截断、漂移报错、
  就近选取与 warnings。

## Acceptance Criteria

- [ ] `db:seed:local` 链含 0006；`local-demo-seed.test.mjs` 的"exactly 1 enabled source"仍通过。
- [ ] `db:reset:local` 后运行 `local:collect`：三个来源完成调度（NOAA + WB + JPX），WB 两条
  月度序列与 JPX 两条日度序列落库为真实观测；`/data-health` 本地 sources=3。
- [ ] `/api/v1/indicators/:id/series` 对四个新指标返回真实点（本地 TEST ONLY public=1）。
- [ ] Contract 测试：合成 XLSX/CSV fixture 全绿；漂移场景（缺列/缺表/非数值）fail-closed。
- [ ] lint、typecheck、npm test、integration、security、build、check:bundle、e2e、demo e2e 全绿。

## Out of Scope

- 论点详情页接线（把 WB/JPX 证据挂到 RUBBER 论点）——需要 D 组签字与编辑流程，另行安排；
- staging/生产启用与登记册签署（外部授权链）；
- SGX/SHFE 付费 EOD 与 FBX 运价采购（A-Ⅲ 不变）。

## Dependencies

- 外部仅两个真实文件（开发期探查公开发布物结构，不提交内容）：WB XLSX 586,735B（HEAD 实测
  200，`Last-Modified`，无 ETag）；JPX `rb_e20260918.csv` 3,730,649B（英文全部衍生品单文件）。
- 前置提交：A 组采购计划第四层（`e91468d`）。
