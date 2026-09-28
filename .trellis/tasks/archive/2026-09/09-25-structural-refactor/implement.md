# 批次三执行清单

## Round A（并行，无文件交集）
- [ ] R2 适配器公共基座（src/worker/adapters/sources/）：adapter-base.ts + 五份 unchangedResult/三份 decodeUtf8 消解；jpx/unctad/census 只提取可复用片段；registry 收敛；契约测试零修改绿
- [ ] R3 领域收敛（src/domain/）：internal/{freeze,compare,time}.ts；initial-thesis-seeds 工厂化；快照与种子测试零意外漂移
- 验证：`npx vitest run src/worker/adapters/sources src/domain && npm run lint && npm run typecheck`

## Round B
- [ ] R1 index.ts 拆分两步走：先机制层（http/{router,envelope,body,errors} + context.ts），后路由层（routes/{public,admin,discovery}）；表征测试断言零修改；新增 405/路由矩阵/context 单例测试
- 验证：`npx vitest run src/worker && npm run test:integration && npm run test:security && npm run lint && npm run typecheck`

## Round C（并行）
- [ ] R4 边缘缓存（worker fetch 入口 + worker.fetch 补 ctx）；假 cache 单测
- [ ] R5 杂项：tsconfig 拆分（web/worker）、engines >=24、迁移 0013 + 查询计划断言
- 验证：全量门禁 + `npm run db:migrate:local`

## 收尾
- [ ] 全量门禁：lint / typecheck / test / build / check:bundle / test:integration / test:security
- [ ] trellis-check 全范围复查
- [ ] spec 回写判断（路由表/context 模式）
- [ ] 提交计划（R2/R3/R1/R4/R5 各一个提交）→ 确认 → 提交 → 归档

## 红线
- 对外行为零变化（除 405+Allow 与缓存头两个声明项）；表征测试断言零修改
- 种子/契约/快照输出逐字节不变；迁移只增不改；领域层无 IO
