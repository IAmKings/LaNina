# 对外授权与签字请求清单

> 用途：把 `09-07-release-quality` 中依赖仓库之外的条件，整理成可以直接发出、可直接回复的请求清单。
> **当前状态：本文件只是请求模板与清单，尚未向任何来源方、账户负责人或管理员发出；仓库中不存在任何
> 已完成的授权、资源或演练。** 每项完成后，请把回执登记到
> [`source-release-register.md`](source-release-register.md) 的"最小签署与安全证据"表，
> 或在对应工单中留存脱敏证据（不要填入姓名、邮箱、API key、账户号、合同原文或 snapshot key）。

## 0. 谁能解锁什么

**可直接转发的一页纸请示**（填写回执后回传即可）：

| 组 | 一页纸 | 致 |
|---|---|---|
| B | [开通 staging 资源与预算授权](requests/to-account-and-budget-owner.md) | Cloudflare 账户 / 预算负责人 |
| C | [建立后台访问控制与三个测试角色](requests/to-access-identity-admin.md) | Cloudflare Access / 身份管理员 |
| D | [六条论点与阈值的首版签字](requests/to-research-and-product-owner.md) | 研究负责人 + 产品负责人 |

| 角色 | 需要的动作 | 解锁的验收项 |
|---|---|---|
| 来源方 / 法务 | 四个来源的书面权利确认（A 组） | 父任务 AC-05、AC-08；任务 5 清单第 6 项 |
| 商业数据供应商 | 运价/橡胶/MPOB 等合同（A2 组） | AC-07 的完整市场确认、§18 第 3–4 项 |
| Cloudflare 账户与预算负责人 | staging/production 资源与额度授权（B 组） | AC-01、AC-02、AC-15；任务 5 清单第 10 项 |
| Cloudflare Access 管理员 | 后台应用与三个测试角色（C 组） | AC-11；任务 5 清单第 5 项 |
| 研究 / 产品负责人 | 区域、阈值与市场范围签字（D 组） | AC-05、AC-14 的前提；§18 全部 |
| 运维 / 值班 | 告警目的地与故障注入批准（E 组） | AC-12；任务 5 清单第 7 项 |
| 数据 / 发布负责人 | 三天演练与键盘验收窗口（F 组） | AC-14、AC-10、AC-11 |

---

## A. 来源权利与许可（可直接发送）

发送前请确认：不要附带任何 API key；只提出权利问题，不询问技术参数。每封信都需要对方对**六项边界**
给出明确答复：① 自动抓取/轮询是否允许；② 原始响应是否可私有留存；③ 是否可派生并公开派生值；
④ 公开受众范围（含商业访问者）；⑤ 署名与不背书要求；⑥ 修订、删除与终止后的义务。

### A1. NOAA CPC RONI（唯一当前 `enabled=1`、`public=1` 的来源）

- **source / indicator**：`noaa_cpc_roni` / `enso_roni_ersstv6`
- **已备证据**：[`noaa-cpc-roni-license-pre-review.md`](noaa-cpc-roni-license-pre-review.md)、
  `.trellis/tasks/09-07-release-quality/research/noaa-cpc-roni-rights-evidence.md`
- **请求要点**：RONI 页面（CPC/NWS 页脚、NWS Disclaimer、NOAA Internal Source Data 的条件性 CC0）
  已确认更新节奏与"首次发布后最多两个月可能修订"，但**没有**把 RONI 表格直接绑定 CC0，
  也未对自动抓取、私有留存、商业/API/国际再分发作出专属批准。请就上述六项边界作出书面确认。
- **我方需要拿到**：书面答复或被明确指向的适用条款；确认署名文案（NOAA/CPC，不暗示背书）。
- **当前仓库行为**：已启用，但三类签署为 `pending`，**生产阻塞**。

### A2. NASA POWER 区域降水（4 个来源、4 个指标，当前 `enabled=0`、`public=0`、`derived_only`）

- **source / indicator**：
  `nasa_power_rainfall_southern_thailand_rubber_v1` / `regional_rainfall_southern_thailand_rubber_v1`；
  `nasa_power_rainfall_maritime_continent_palm_v1` / `regional_rainfall_maritime_continent_palm_v1`；
  `nasa_power_rainfall_southern_africa_maize_v1` / `regional_rainfall_southern_africa_maize_v1`；
  `nasa_power_rainfall_panama_canal_catchment_v1` / `regional_rainfall_panama_canal_catchment_v1`
- **已备证据**：[`nasa-power-regional-rainfall-license-pre-review.md`](nasa-power-regional-rainfall-license-pre-review.md)
- **请求要点**：仅公开**区域日均等派生统计**（不公开点位原始值与响应）；确认自动 API 与 robots 的关系、
  私有原始响应留存、派生公开与署名（POWER、服务版本、访问日期、链接）。
- **我方需要拿到**：上述六项边界 + 12 个月点位可用性说明；随后才能做 3 天 smoke 与研究代表性审查。
- **注意**：Panama catchment 只是代理，**不是** ACP 一手水文事实。

### A3. USDA FAS PSD（马来西亚棕榈油 / 南非玉米，当前 `enabled=0`、`public=0`、`derived_only`）

- **source / indicator**：`usda_psd_malaysia_palm_oil`（`_production_1000mt`、`_exports_1000mt`、
  `_ending_stocks_1000mt`）；`usda_psd_south_africa_corn`（同三类指标）
- **已备证据**：[`usda-fas-psd-license-pre-review.md`](usda-fas-psd-license-pre-review.md)
- **请求要点**：确认为 marketing-year **估计**（不得称 MPOB 月度实际或 CEC/SAGIS 实物流）；
  确认自动访问与限额、私有留存、派生公开、精确值的国际展示与归因要求。
- **我方需要拿到**：书面范围确认；随后才配置 Worker secret、观测 key 限额并完成 3 次 smoke。

### A4. EIA Europe Brent 现货（当前 `enabled=0`、`public=0`、`derived_only`）

- **source / indicator**：`eia_europe_brent_spot` / `eia_europe_brent_spot_usd_per_bbl_daily`
- **已备证据**：[`eia-europe-brent-license-pre-review.md`](eia-europe-brent-license-pre-review.md)
- **请求要点**：该表当前标注的 Refinitiv/LSEG 第三方输入风险需澄清；确认私有留存、派生、
  exact-value 展示、下载/API、商业与国际再分发及删除义务。
- **我方需要拿到**：EIA（必要时含第三方）的书面范围；始终只作为**广义燃油成本控制变量**，
  绝不称船燃、附加费、运力或美东/欧线运价。

### A5. 商业数据候选（合同类，当前为 `restricted` 或 `COVERAGE_GAP`）

| 领域 | 需要的合同或授权 | 影响的论点 |
|---|---|---|
| 亚洲—美东 / 亚洲—欧洲运价 | SCFI/CCFI、Freightos/Baltic FBX、Drewry WCI、Xeneta XSI-C 任一：航线级历史、派生、公开展示/再分发与投资模型用途 | `SHIP-USEC-01`、`SHIP-EU-01`（当前置信度上限 59） |
| 航线可靠性 | Sea-Intelligence GLP 或可审计的中立来源，含路线级历史与交付 | 同上 |
| 橡胶实物 | MRB/LGM、RAOT、DOSM 的抓取/留存/派生/公开字段与 12 个月机器可用性 | `RUBBER-TH-01` |
| 橡胶日频市场 | SGX SICOM、JPX/OSE、SHFE/INE 一家的企业 EOD 合约（历史、留存、派生、公开再分发、费用、换月、终止删除） | `RUBBER-TH-01` |
| 棕榈油 / 玉米实测 | MPOB 月度、南非 CEC/Department 预测与 SAGIS 实物流（API/SFTP 或书面许可） | `PALM-SEA-01`、`MAIZE-SA-01` |
| Panama 一手 | ACP 对自动收集、私有留存、派生、公开展示的书面授权；advisory 仅存 ID/标题/状态/日期/官方 URL | `SHIP-USEC-01` |

- **已备证据**：[`source-release-register.md`](source-release-register.md) 的"未配置候选与覆盖缺口"表，
  以及 `docs/sources/*.md` 六份 Source Spike。
- **现状口径**：未授权前不抓取、不留存、不派生、不公开；页面保留 `COVERAGE_GAP` 标签，
  相关论点不因价格变化升级到"市场确认"。

---

## B. Cloudflare 账户与预算授权（staging + production）

- **对象**：账户 / 预算负责人。
- **请求内容**（逐项都需要明确批准或拒绝）：
  1. 创建**独立 staging** Worker、D1、R2、Access 应用（不得复用 production 凭据、预算或域名）。
  2. 提供 staging 的 D1 `database_id` 与 R2 bucket 名称，用于替换 `wrangler.jsonc` 中的占位值
     （当前为 `00000000-…-0001` / `-0002`）。
  3. 明确 **Free 还是 Paid**，以及月度预算上限与预算告警阈值（PRD §16.3 要求 70% 预警、90% 升级）。
  4. 生产资源创建的**独立授权**（本清单只申请 staging）。
  5. 正式产品名称与域名（PRD §18 第 1 项；当前开发名 `enso-monitor`）。
- **我方需要拿到**：资源 ID、计划选择、预算上限、域名、批准变更号。
- **仓库锚点**：`wrangler.jsonc`；前置向导
  [`../../scripts/cloudflare-staging-preflight.sh`](../../scripts/cloudflare-staging-preflight.sh)
  （六阶段只读核对，证据写入被忽略的 `.local-evidence/`，执行者需人工确认每一步）。

---

## C. Cloudflare Access 与身份

- **对象**：Access / 身份管理员。
- **请求内容**：
  1. 为 `/admin/*` 创建 Access 应用，提供 **issuer、audience、JWKS URL**（写入 staging secrets）。
  2. 建立三个角色的测试身份各一：`viewer`、`editor`、`publisher`。
  3. 说明角色来自哪个 IdP 组/声明，以便与代码中的角色层级映射一致。
  4. 提供一个**受控验收窗口**：允许 publisher 在 staging 上完成一次"审核 → 发布 → 撤回"，
     并允许导出该窗口的审计记录用于验收取证。
- **我方需要拿到**：三个测试身份的可用性、窗口时间、审计导出方式。
- **仓库锚点**：`src/worker/modules/access-auth.ts`（JWKS 验签、iss/aud/exp、角色层级、fail-closed）；
  `docs/operations/recovery-runbook.md` 第 3 节（撤回流程）。

---

## D. 研究 / 产品签字（PRD §18 的十项业务输入）

- **对象**：研究负责人 + 产品负责人（可合并为一次评审）。
- **需要逐项确认的内容**：
  1. 六条论点的中文标题、研究责任人与市场期限；
  2. 各区域降水 polygon 或省份清单；
  3. 每条论点的首版阈值与连续确认次数；
  4. 传导阶段进入门槛的业务解释；
  5. 置信度上限（49/59/69）与四项权重的业务确认；
  6. coverage gap 的公开标签与话术；
  7. 首月人工发布安排、后台编辑者与发布者名单；
  8. 自动发布是否开启（默认建议：先保持关闭）；
  9. 预警收件人；
  10. Free/Paid 与预算上限（与 B 组联动）。
- **我方需要拿到**：登记册"产品/研究审核"行的批准记录（可只填角色、日期、内部证据编号）。
- **仓库锚点**：`src/domain/initial-thesis-seeds.ts`（六条种子当前 `reviewStatus: "pending"`，
  所有 selector/rule/threshold 均为 `pending`，因此生产评估在访问 D1 前即返回
  `PENDING_RESEARCH_APPROVAL`）。

---

## E. 告警与故障注入授权

- **对象**：运维 / 值班负责人 + 来源负责人。
- **请求内容**：
  1. 提供告警接收地址（邮件或值班平台）与升级路径；
  2. 批准在 staging 按 [`staging-alert-rehearsal-evidence.md`](staging-alert-rehearsal-evidence.md)
     的六类场景**逐一**注入：Cron 缺失、P0 来源连续失败、日报延迟、公开 API 5xx、解析观测骤降、
     预算阈值；
  3. 确认"每次只演练一个故障、可恢复、不影响 production"的停止条件；
  4. 预算类场景**不得**通过人为消耗资源触发，只接受平台测试或 sandbox 计量记录。
- **我方需要拿到**：收件人、批准窗口、每类注入的执行人。
- **仓库锚点**：`src/worker/index.ts` 的 Cron 结构化日志（只输出 job/date/outcome/count/status/errorCode）。

---

## F. 验收窗口与证据留存（三天演练 + 性能 + 键盘）

- **对象**：staging 数据所有者 + 发布者。
- **三天 soak 前置**：`ENABLE_CRON=false` / `ENABLE_AUTO_PUBLICATION=false` 保持不变；
  发布入口已就绪（`POST /api/admin/daily/:date/publish`，后台页 `/admin/daily`），
  因此每天可以产出真实的"已发布"或"明确延迟"证据。
- **每天需要留存**（按北京时间）：
  - 06:30（22:30 UTC）评估：run 记录、六条草稿状态（当前预期为 `PENDING_RESEARCH_APPROVAL`，
    完成 D 组签字后才会产生草稿）；
  - 07:00（23:00 UTC）发布判定：发布或延迟的 decision、`briefDate`、上一版页面仍可读的截图；
  - 来源健康、公开页面读取结果、日志查询链接。
  - 任何 critical failure 重新开始计数。
- **性能测量**（工具已就绪，需要已部署目标）：
  ```bash
  npm run benchmark:public-api -- \
    --base-url https://<staging-domain> \
    --path /api/v1/overview \
    --expect-cache-control "public, max-age=60, stale-while-revalidate=300" \
    --max-p95-ms 800
  # 缓存命中路径需显式要求 CF-Cache-Status: HIT 并使用 300ms 阈值
  ```
- **键盘验收**：在真实 Access 下由 publisher 用键盘完成一次发布/撤回，留存截图与审计导出。
- **本机预演**：正式窗口前可用 `npm run local:collect|local:evaluate|local:publish` 在本机跑同一
  `handleScheduled` 路径，确认当日操作顺序与预期结果（这些命令只写本地 D1，不代表 staging 结果）。
- **仓库锚点**：`ac-traceability.md`（AC-10/AC-11/AC-14 的缺口描述）、
  `docs/operations/recovery-runbook.md` 第 8 节（仅限 staging 的演练清单）。

---

## G. 回执登记（复制到工单或直接填入登记册）

| 请求 | 对象 | 发出日期 | 回执（批准/拒绝/附条件） | 证据编号 | 影响项 |
|---|---|---|---|---|---|
| A1 NOAA CPC RONI 权利确认 | | — | `pending` | — | AC-05、AC-08 |
| A2 NASA POWER 区域降水 | | — | `pending` | — | AC-05、AC-08 |
| A3 USDA FAS PSD | | — | `pending` | — | AC-05、AC-08 |
| A4 EIA Europe Brent | | — | `pending` | — | AC-05、AC-08 |
| A5 商业数据合同（运价/橡胶/MPOB/Panama） | | — | `pending` | — | AC-07、§18 |
| B staging 资源与预算 | | — | `pending` | — | AC-01、AC-02、AC-15 |
| C Access 应用与三角色 | | — | `pending` | — | AC-11 |
| D 研究与阈值签字 | | — | `pending` | — | AC-05、AC-14 |
| E 告警与故障注入批准 | | — | `pending` | — | AC-12 |
| F 三天演练 / 性能 / 键盘窗口 | | — | `pending` | — | AC-10、AC-11、AC-14 |

> 登记规则：只写角色、日期与安全证据路径/变更号。若某项被"附条件批准"，请在证据栏注明条件，
> 并同步更新 `source-release-register.md` 对应行的"决定"列。

## A 组采购计划

A 组已拆成四层：A-Ⅰ 授权函（零成本，新增 JPX/OSE 当日 CSV 授权目标）、A-Ⅱ 公共数据源（World Bank Pink Sheet CC BY 4.0 + JPX 滚动自建存档）、A-Ⅲ 商业合同（付费）。逐家"免费可用部分 / 免费边界 / 机器化三问"与 A-Ⅱ+ 滚动存档阶梯见 [a-group-procurement-plan.md](requests/a-group-procurement-plan.md) 第四层。
