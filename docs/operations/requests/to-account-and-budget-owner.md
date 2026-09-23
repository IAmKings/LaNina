# 请示：开通 staging 资源与预算授权（B 组）

| | |
|---|---|
| **致** | Cloudflare 账户 / 预算负责人 |
| **发起** | ENSO 市场影响监测平台（项目负责人：kuluoluo） |
| **日期** | 2026-09-15 |
| **建议回复期限** | 3 个工作日内（本组是三天 staging 演练的前置） |
| **一句话** | 需要你批准并创建一个**独立 staging**（Worker + D1 + R2），提供真实 D1 ID 与计划选择；在此之前项目无法做任何环境级验收，也无法上线。 |

## 一、为什么需要你

1. 代码、迁移、测试与页面已完成，但 `wrangler.jsonc` 中三个环境的 D1 ID 仍是**占位值**
   （`00000000-…-0000/0001/0002`），R2 bucket 也不存在 —— 部署无法解析绑定。
2. 产品 PRD §15 与发布任务停机条件要求：**生产资源创建、付费计划、域名与部署均需显式账户授权**。
   项目方不会自行创建任何资源（现有脚本只做只读核对）。
3. 上线前还必须在 staging 连续三天跑通"06:30 生成草稿 / 07:00 发布或明确延迟"，没有资源就没有证据。

## 二、需要你决定或执行的事项

- [ ] **B1 创建独立 staging 资源**（不得复用 production 凭据、预算或域名）：
      Worker `enso-monitor-staging`、D1 `enso-monitor-staging`、R2 `enso-raw-staging`。
- [ ] **B2 提供 staging 的 D1 `database_id`**（用于替换 `wrangler.jsonc` 占位值）。
- [ ] **B3 选择计划与预算上限**：staging 用 Free 即可；生产建议 Workers Paid。
      请给出**月度预算上限**与告警阈值（PRD §16.3：70% 预警、90% 升级）。
- [ ] **B4 指定正式产品名称与域名**（含是否使用 `staging.<domain>`）。
- [ ] **B5 说明生产资源是否另行授权**（本请示只申请 staging；生产创建需单独书面授权）。
- [ ] **B6 指定告警接收邮箱**（用于来源/Cron/日报/API/预算告警）。

## 三、容量假设（供预算判断）

PRD §16.1 的 P0 假设，用于判断免费额度是否够用：

| 维度 | 假设 |
|---|---|
| 来源 / 指标 | ≤20 个来源、≤100 个指标 |
| 观测写入 | 每天新增 ≤10,000 行 |
| 原始快照（R2） | 每天 ≤100 MB（目标远低于此值，仅私有留存） |
| 日访问量 | ≤10,000 |
| 定时任务 | 4 个 Cron：每 15 分钟、每小时、22:30 UTC、23:00 UTC |

在这些假设下 D1 5 GB 与 R2 10 GB-month 的免费额度足以开发和早期试运行；**生产建议 Workers Paid**
以获得更合理的 CPU 与运行保障。商业数据采购费用不在本项目预算内、单独核算。具体计费以 Cloudflare
当期价目为准，本请示不预设金额。

## 四、需要的回执（可直接复制填写）

```text
批准 / 附条件 / 拒绝：
环境：staging
Worker 名称：
D1 名称 + database_id：
R2 bucket 名称：
计划（Free/Paid）：
月度预算上限 + 告警阈值：
域名：
告警接收邮箱：
生产资源是否另行授权：
批准人角色 / 日期 / 内部工单号：
```

> 只填角色、日期与内部工单号即可，**不要**在回执里附账户号、API key、账单明细或合同原文。

## 五、如果延后

1. 三天 staging 演练无法开始 → 父任务 AC-01、AC-02、AC-14、AC-15 无证据；
2. 产品 PRD §14.4 的 13 项发布验收中，8 项依赖 staging（Lighthouse、备份恢复、Workers Logs 等）；
3. 生产上线日期不可确定；当前系统在这些证据齐备前**不会**发布任何研究结论（设计上的 fail-closed）。

## 六、参考

- 完整请求清单：[`../external-authorization-requests.md`](../external-authorization-requests.md)（B 组）
- 来源与许可登记册（三项签署状态）：[`../source-release-register.md`](../source-release-register.md)
- 只读前置核对向导：[`../../../scripts/cloudflare-staging-preflight.sh`](../../../scripts/cloudflare-staging-preflight.sh)
- 环境与容量要求：产品 PRD §15、§16
