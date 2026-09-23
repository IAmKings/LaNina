# 数据采集与来源适配器

## Goal

将合规的气候、天然橡胶、农业和航运来源稳定转换为标准观测与私有快照，并让系统准确表达数据的新鲜、延迟、过期、失败和修订状态。

## Requirements

- 对每个候选来源完成产品 PRD §8.7 Source Spike，先确认许可再自动化。
- 实现统一 SourceAdapter 与 Ingestion 接口，来源解析不得直接写 D1/R2 或计算论点。
- 保存 `source_run`、内容哈希、ETag/Last-Modified、快照和标准观测。
- 支持相同内容去重、同观测期修订、部分成功和 1/5/20 分钟退避。
- 实现统一调度器与四类 Cron，不为每个来源创建 Cron。
- 实现 healthy/delayed/stale/broken/恢复状态。
- 首批至少接入 NOAA CPC/RONI、一个区域降水来源、Panama Canal Authority；再接橡胶、MPOB/农业、航线市场/控制来源。
- 对无法授权或无法稳定解析的来源提供明确的人工/缺失降级，不抓取受限内容。

## Acceptance Criteria

- [x] 每个上线来源有许可、格式、频率、修订、故障与 fixture 记录。
- [x] 每个适配器通过 normal/unchanged/invalid 三个契约样本。
- [x] 同一 ETag/哈希重跑不重复写入。
- [x] 修订创建新 revision 并指向上一版本。
- [x] 单来源失败不阻塞其他到期来源。
- [x] 连续三次失败进入 broken；首次成功后恢复并生成恢复事实。
- [x] 429/5xx 可重试，普通 4xx 不盲目重试。
- [x] 大文件不在 Worker 内整体缓冲；无法安全处理时使用人工路径。
- [x] 六条论点至少各获得一个自动事实来源，或明确进入 coverage gap。
- [x] 原始快照不可公开访问，日志不含密钥/受限正文。

## Out of Scope

- 论点方向、阶段和置信度；
- 网页和后台发布体验；
- 付费数据采购；
- 全球栅格处理和 AIS 全量轨迹。

## Dependencies

- `09-07-platform-foundation` 完成。
- D1 schema、domain types 和 SourceAdapter contract 已冻结。
