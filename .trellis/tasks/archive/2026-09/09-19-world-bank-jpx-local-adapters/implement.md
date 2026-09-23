# Implement — 零成本数据源落地

## Checklist

- [ ] `seeds/0006_world_bank_jpx.sql`（2 来源 + 4 指标，默认停用/pending 模式）。
- [ ] `seeds/9002_test_only_local_free_sources.sql` 与 `db:seed:local`、`db:reset:local` 接线。
- [ ] `src/worker/adapters/sources/minimal-xlsx.ts`（ZIP 解包 + DecompressionStream + sharedStrings + 单元格表）。
- [ ] `src/worker/adapters/sources/world-bank-pink-sheet.ts`（条件 GET + 表定位 + 月度窗口）。
- [ ] `src/worker/adapters/sources/jpx-ose-settlement.ts`（两跳 + rubber 过滤 + 就近合约）。
- [ ] `registry.ts` + `registry.test.ts` + `live-smoke-targets.ts` 接线。
- [ ] 两个 contract 测试（合成 fixture）。
- [ ] 本机端到端：`db:reset:local` → `local:collect` → 系列接口核验。
- [ ] 全量门禁（lint/typecheck/npm test/integration/security/build/check:bundle/e2e/demo e2e）。

## Validation

```bash
npm run db:reset:local
npm run local:collect
curl http://127.0.0.1:5173/api/v1/data-health   # sources 应为 3（本地）
npm run lint && npm run typecheck && npm test
npm run test:integration && npm run test:security
npm run build && npm run check:bundle
```

## Delivery Gate

- 不提交任何第三方数据行或响应体；fixture 全部仓库内合成。
- 生产/staging 启用门槛不变（登记册三项签署）。
- 3.7MiB 上限放宽仅限 JPX 适配器并有实测注释（PRD §16.3 成本护栏口径内）。

## Progress Log

- 立项：A-Ⅱ 零成本阶梯（`e91468d`）→ 本任务实现并本地实测。
- **完成（2026-09-19）**：`seeds/0006_world_bank_jpx.sql`（2 来源 + 4 指标，默认停用）；
  `seeds/9002_test_only_local_free_sources.sql` + `db:reset:local` 接线（CI 不变）。
  `minimal-xlsx.ts`（ZIP STORED/DEFLATE + sharedStrings）、`world-bank-pink-sheet.ts`、
  `jpx-ose-settlement.ts`（两跳 + rubber 行过滤 + 就近合约）落地；contract 测试以
  合成 fixture 完成（0 第三方数据行）。
- **本机端到端实测**：`db:reset:local` 后运行 `local:collect` —— NOAA + JPX + WB
  3 个来源真实调度成功；WB 18 个月 × 2 = 36 条月度观测落库（USD/kg），
  JPX 2 条日度就近合约观测落库（JPY/kg，provisional）；
  `already_processed` 幂等重放与 `AUTOMATED_WINDOW_TRUNCATED`/`JSCC_REVISION` 警告
  均按设计出现。第一次本地 WB 抓取曾因"单次 D1 预算 50 语句"失败——月度窗口从
  24 收敛到 18，是比放宽预算更合规的修正。
- **验证**：武器门禁全部通过；WB/JPX 明确标测算 options 为 provisional / 观测未发布。
