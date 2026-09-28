# 代码库加固：三批修复（P0/P1/重构）

## Goal

承载 2026-09-25 深度代码分析得出的三批修复任务树，按批次独立规划、实现、验证、归档。父任务持有需求集、任务映射与跨子验收，不承担直接实现。

## 需求集（来源：深度分析报告，2026-09-25）

五类问题：

1. **采集管道健壮性**：全 HTTP 层无超时 + 串行 dispatch（cron 链路可被单源拖死）；UNCTAD null 值静默落库；手写 XLSX 解压无上限（zip 炸弹）；EIA 窗口截断、UNCTAD 回溯缺失、partial 健康度失真、病态候选占坑、首采无租约。
2. **存储层**：论点详情指标序列与每日评估输入两个无界查询（随时间线性膨胀）；`source_runs.finished_at` 无索引；0010 触发器缺豁免/链接不相交检查（可造成永久不可读 published brief）；`changes()=1` 守卫、revision 读-改-写竞态、乐观锁排序键。
3. **领域逻辑**：方向字段结构性退化为「有证据即 bullish」；manual forward skip 端到端死特性；`sameJson` 键序敏感；置信度 caps 双事实来源；coverage 分母随阶段缩放；material-change 幂等键缺 cutoff。
4. **Worker 核心与前端**：JWKS 零缓存、审计身份占位符、fetch 路径零日志、cron partial 死值、HEAD 404、无 405 语义、前端无 404 路由（软 404）、2273 行 index.ts 结构债。
5. **配置与部署**：production D1 占位符、`deploy` 脚本绕过 bundle 预算门禁、production cron/flag 组合未文档化、engines 上限过紧。

## 子任务映射

| 子任务 | 内容 | 顺序依赖 |
|---|---|---|
| `09-25-p0-pipeline-storage-fixes` | 批次一 P0：1.1-1.8（超时/并发、无界查询、索引、UNCTAD、XLSX、前端 404、部署加固、可观测性速修） | 无 |
| `09-25-p1-consistency-fixes` | 批次二：2A 直接修（JWKS/审计/采集语义/存储一致性/领域/前端）+ 2B 四份决策单待用户签字 | 依赖批次一先落地（同文件改动顺序） |
| `09-25-structural-refactor` | 批次三：index.ts 拆分、适配器公共基座、领域工具收敛、边缘缓存、tsconfig/engines/索引杂项 | 依赖批次一、二的 index.ts/http.ts 改动先落地 |

## 跨子验收标准

- [ ] 三个子任务全部归档；每批完成后全量门禁绿：`npm run lint`、`npm run typecheck`、`npm test`、`npm run build`、`npm run check:bundle`、`npm run test:integration`、`npm run test:security`
- [ ] 每批一个归档点，批内每任务一个提交（回滚粒度）；迁移只增不改既有文件
- [ ] 批次二 2B 四个决策单（D1 方向语义 / D2 manual skip / D3 coverage 分母 / D4 partial 健康）产出书面文档并经用户签字后才实现对应项
- [ ] 关键修复均有回归测试守护（超时分支、查询计划、触发器不变量、路由 404/尾斜杠）
- [ ] 每个子任务按 Trellis 流程触发 spec 更新判断（新约定回写 `.trellis/spec/`）

## 约束

- 不改变公开 API 契约（除非任务明确要求，如 cron outcome partial）
- 不改变「首月人工发布」「fail-closed」两大产品原则；批次一 1.2 的查询上限不得改变当前页面显示内容（NOAA 全历史 < 500 行）
- 本地验证不触碰 staging/production 资源
