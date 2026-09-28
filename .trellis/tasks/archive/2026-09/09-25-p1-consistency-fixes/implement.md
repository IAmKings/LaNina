# 批次二执行清单

按轮次执行（同轮两个代理无文件交集），每轮完成后跑该域测试；全部完成后全量门禁 + trellis-check。

## Round A（并行，无文件交集）
- [ ] A2 采集语义（sources/ + ingestion/）：EIA 窗口、UNCTAD 回溯、病态候选退避、JPX ETag/304+坏行、TextDecoder fatal、首采租约
- [ ] A3 存储一致性（storage/ + migrations/）：0012 触发器不相交、EXISTS 守卫、revision 内联、rowid 排序、storage-logging 接入
- 验证：`npx vitest run src/worker/adapters src/worker/ingestion && npm run db:migrate:local`

## Round B（并行，无文件交集）
- [ ] A1 安全/可用性（access-auth、index、security-headers）：JWKS 缓存、审计 email 强制、body 64KB 上限、COOP/CORP
- [ ] A5 前端体验（src/web/）：aria-busy、互斥+signal、Intl 缓存、ECharts 视口懒加载、isAbort
- 验证：`npx vitest run src/worker/modules src/worker/index.test.ts src/web && npm run test:security`

## Round C（单独）
- [ ] A4 领域修正（src/domain/）：sameJson、caps 收敛、幂等键 cutoff、拒绝重复 evidenceId、easing 约束、topChanges 排序
- 验证：`npx vitest run src/domain`

## 收尾
- [ ] 全量门禁：lint / typecheck / test / build / check:bundle / test:integration / test:security
- [ ] trellis-check 全范围复查
- [ ] 2B 四份决策单写入本任务 research/，交用户签字（D1 方向语义 / D2 manual skip / D3 coverage 分母 / D4 partial 健康）
- [ ] 提交计划（每域一个提交，`fix(p1): …`）→ 确认 → 提交 → 归档

## 红线提醒（代理须知悉）
- 迁移只增不改；0012 必须真实应用验证
- 公开 API 契约不变；partial 健康度语义不动（D4 范围）
- A4 幂等键与 A3 revision 内联是仅有的行为变化，测试必须锁定新旧差异
- 领域层保持纯函数无 IO
