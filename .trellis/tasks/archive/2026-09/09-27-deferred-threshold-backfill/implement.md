# 回填执行清单

## Round 1：L0 机制 + USDA 派生（无气候依赖）

- [x] 读 USDA 适配器确认 marketing-year 的 observed_at 语义（设计前提）
- [x] 迁移 0014：5 派生指标（含作物窗口）+ 4 气候态指标行（indicators，归属父源）；种子 0003/0004 同步，覆盖「先迁移后播种」
- [x] L0 派生步骤：daily-schedule 评估前执行；幂等追加写入（同值 skip / 变值新 revision）
- [x] USDA 两项派生计算：palm 期末库存同比 %、maize 产量对五年均值比 %
- [x] 测试：派生幂等、revision 语义、USDA 派生数值正确性（构造 MY 序列）、评估管道消费派生观测
- 验证：`npx vitest run src/worker src/domain && npm run db:migrate:local && npm run lint && npm run typecheck`

## Round 2：气候态采集 + 距平派生 + 全部种子规则

- [x] NASA 月气候态 collect 变体（显式 start=1991&end=2020，header.range 核对；月序 12 观测；27 日内跳过；评估 cron 在派生重算之前）
- [x] 降水距平派生：30 日（rubber）、90 日（palm）、11–3 月作物窗口（maize；跨年未完结不产出）
- [x] 种子：5 个 selector（每条数值规则各映射自己的派生指标；存在性规则与阶段门 ruleIds 不动）+ 5 条 numeric 规则 + directionPolicyFor 补条目
- [x] 测试：距平计算（含闰年/跨年/未完结窗口 fail-closed）、规则命中边界（恰为阈值，容差 4×EPSILON）、仅有存在性证据时守卫仍在、USEC/欧线无数值规则、场景快照逐条声明
- 验证：全量门禁（lint / typecheck / test / build / check:bundle / test:integration / test:security）+ db:migrate:local

## 收尾

- [ ] trellis-check 全范围复查
- [ ] spec 回写判断（派生指标模式）
- [ ] 提交计划 → 确认 → 提交 → 归档
- [ ] USEC 两条规则：G2 权利预审后另立 ACP 适配器任务（本任务注记不关闭该 follow-up）

## 红线

- 签字数值不得偏离（−25/−10/−15/−25/−25；USEC ≤24/≤48 本轮不实现）
- 现有 24 条存在性规则与阶段门 ruleIds 一字不动；coverageGap 不动
- 迁移只增不改；领域层纯函数无 IO；D1 守卫保留
