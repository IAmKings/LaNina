# 决策单 D4：partial 采集结果的源健康语义

签字：KingsLZ（2026-09-26 会话确认）

## 现状与证据

`cloudflare-ingestion.ts:153-154`：partial 结果时 `previousHealth` 短路为 null；`:509-513` partial 分支只推进 `next_due_at`，**不刷新** `last_success_at`、不计失败。

后果：NASA POWER 只要 14 天窗口内**任何一天**点位覆盖率 < 0.75 就整体 partial（`nasa-power-regional-rainfall.ts:363-367,152`）——降水雨季/缺测期低覆盖很常见。于是源健康面板长期显示「延迟/陈旧」（last_success_at 停在很久以前），但实际上一半数据成功落库了。误报「源坏了」，掩盖真实故障信号。

批次一、二已落地的修复都不触碰此语义（cron outcome 的 partial 是调度层报告，与源健康度是两回事）。

## 选项

| 选项 | 内容 | 优点 | 代价 |
|---|---|---|---|
| A | partial 刷新 `last_success_at`（视为「部分成功」） | 面板不再长期误报陈旧 | 「成功」语义被稀释——真正该看到的降级被抹平；consecutive_failures 计数语义需要连带定义 |
| B（推荐） | 引入独立 degraded 健康态：partial 使 source 进入 `degraded`（介于 healthy 与 stale 之间），刷新 `last_success_at` 但保留独立标记与文案 | 诚实三分：healthy / degraded / stale；面板能区分「数据新但质量降级」与「真的没数据」 | 需要迁移加状态值（source health 的 CHECK/展示枚举）、admin runs 与公开 data-health 两处展示适配 |

## 推荐

**B**。这个项目的公开 data-health 页面卖点是「来源健康可核查」，一个把 partial 抹成 success 或一直报陈旧的模型都失真。实现路径：迁移 0013 放宽/扩展 source health 状态表达（若状态是从 runs 派生而非存储列，则只需派生逻辑+展示），`data-health` 投影加 degraded 呈现，admin runs 列表同步。

需要你确认的第二层口径：**NASA 的 0.75 覆盖率阈值在雨季是否定得过高**（决定 partial 频率本身）。若阈值要调，属种子/适配器参数变更，可在 D4 落地时一并签字。

## 影响面

- `cloudflare-ingestion.ts`（partial 分支的健康推进）、source-health 派生/存储、`cloudflare-read-models.ts` dataHealth 投影、admin runs 视图、公开 data-health 页文案；新增测试覆盖 partial→degraded→恢复 healthy 的状态迁移。
- 无冻结/简报依赖（source health 快照进 brief 冻结，degraded 值会进入新快照——历史冻结不变）。

## 回滚

代码单提交回滚；若引入状态枚举迁移（0013），迁移按只增纪律保留（旧代码忽略新值即可），无需反向迁移。
