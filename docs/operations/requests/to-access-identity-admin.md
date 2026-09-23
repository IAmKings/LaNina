# 请示：建立后台访问控制与三个测试角色（C 组）

| | |
|---|---|
| **致** | Cloudflare Access / 身份管理员 |
| **发起** | ENSO 市场影响监测平台（项目负责人：kuluoluo） |
| **日期** | 2026-09-15 |
| **建议回复期限** | 3 个工作日内（与 B 组同为演练前置） |
| **一句话** | 需要为 `/admin/*` 建立一个 Cloudflare Access 应用，提供 issuer/audience/JWKS URL 与三个测试身份；否则后台在部署环境**按设计完全不可用**（fail-closed）。 |

## 一、为什么需要你

1. 研究后台（`/admin/*`）由 Cloudflare Access 保护：未配置时 Worker 主动拒绝并返回
   `503 AUTH_CONFIGURATION`，这是**有意的安全默认**，不是缺陷。
2. 代码已实现 JWT 验签（JWKS）、`iss`/`aud`/`exp` 校验与角色层级；缺的只是**部署侧的 Access 应用与身份**。
3. 首月采用人工发布每日判定，后台不可用意味着**没有任何发布入口**。

## 二、需要你决定或执行的事项

- [ ] **C1 为 `/admin/*` 创建 Access 应用**（staging 与 production 各自独立）。
- [ ] **C2 提供三项配置值**（将写入 Worker secrets，不需要发给我密钥本体）：
      `ACCESS_JWT_ISSUER`、`ACCESS_JWT_AUDIENCE`、`ACCESS_JWKS_URL`。
- [ ] **C3 建立三个角色的测试身份各一**：`viewer`、`editor`、`publisher`（层级为
      viewer < editor < publisher，高角色包含低角色能力）。
- [ ] **C4 说明角色来源**：代码支持两种映射 —— 按邮箱（`ACCESS_EMAIL_ROLE_MAP`）或按组
      （`ACCESS_GROUP_ROLE_MAP`，读取 JWT 的 `groups` 声明）。请告知使用哪一种，以及在 IdP 侧
      应建立哪些组。
- [ ] **C5 安排一次受控验收窗口**：允许 `publisher` 在 staging 用键盘完成一次
      "审核 → 发布 → 撤回"，并允许导出该窗口的审计记录用于验收取证。
- [ ] **C6（可选）** 指定 token 头名称（默认标准头 `cf-access-jwt-assertion`，可用
      `ACCESS_JWT_HEADER` 覆盖）。

## 三、角色能力（供确认范围）

| 角色 | 可以做什么 | 不可以做什么 |
|---|---|---|
| `viewer` | 读取后台运行记录、草稿审核对比、每日判定预检 | 任何写操作 |
| `editor` | 手动触发单一来源、重算单条论点草稿、编辑草稿的摘要与失效条件 | 发布、撤回 |
| `publisher` | 发布/撤回论点版本、发布每日判定、记录高风险转场审核 | 修改原始观测、快照或计算输入 |

所有写操作都记录操作者、理由与精确版本身份；原始观测与快照不可通过后台修改。

## 四、需要的回执（可直接复制填写）

```text
批准 / 附条件 / 拒绝：
环境：staging（production 是否同时建：是/否）
Access 应用名：
issuer：
audience：
JWKS URL：
角色来源：邮箱映射 / 组映射（组名列出）
三个测试身份是否就绪：viewer / editor / publisher
验收窗口时间（UTC）：
审计导出方式：
批准人角色 / 日期 / 内部工单号：
```

> 只填角色、日期与内部工单号；**不要**附 JWT、cookie、密钥或身份提供商的敏感配置。

## 五、如果延后

1. 父任务 AC-11（未授权用户不可访问后台 + 发布/撤回审计）无部署级证据；
2. 后台键盘验收（AC-10/AC-07 的部署侧）无法完成；
3. 首月人工发布每日判定无操作入口 → 三天演练只能记录"延迟"，无法产出"已发布"证据；
4. 其它依赖真实身份的验收（角色矩阵、审计导出）一并停滞。

## 六、参考

- 完整请求清单：[`../external-authorization-requests.md`](../external-authorization-requests.md)（C 组）
- 鉴权实现（验签、iss/aud/exp、角色层级、fail-closed）：[`../../../src/worker/modules/access-auth.ts`](../../../src/worker/modules/access-auth.ts)
- 撤回与恢复流程：[`../recovery-runbook.md`](../recovery-runbook.md) 第 3 节

## 七、Cloudflare API Token 的权限缺口处理（2026-09-22 视察）

如果负责人提供的是默认"Edit Cloudflare Workers"模板生成 token（以 `cfut_` 开头），该 token
**没有 Cloudflare One Access 的编辑权限**，需要重新生成包含两项 πολДа 权限范围的 token：

- **Account > Access: Organizations, Applications & Policies > Edit**
- **Account > D1: Edit**（可选——已有）
- **Account > Account Settings: Read**
- **Zone > Zone: Read**（不需要 Workers 或 DNS scope，staging 已部署）
- Account Resources: specific account `e6aa4a4d9d4b1da7f...`
- TTL: 24h 即可（或其他时效，用后即可 revoke）

新建入口：https://dash.cloudflare.com/profile/api-tokens → Create Custom Token

## 八、2026-09-22 追加：负责人 token 重新核对

如果负责人的 `cfut_` token 是从 Edit Cloudflare Workers 模板生成（default scope：Edit Workers/D1/R2），
POST `/access/apps` 会返回 `1010 auth.forbidden`，因为 token **没有 Cloudflare One 的编辑权限**。
当时负责人说"access:edit 已加"但实际是 User scopes "--access:edit"而非 Account-scoped token。

新 token 正确的 Custom Token 权限集：
- **Account > Access > Applications & Policies > Edit**
- Account Resources: Include - All accounts（或 specific）
- Zone Resources: Include - All zones

### 记录
- `/access/groups` GET 返回 200 空数组 → Read 权限是有的
- `/access/apps` GET 返回 200 空数组（empty applications 刚部署的 staging 还没有 Access app）
- **POST /access/apps** 返回 `1010 auth.forbidden` → **Write scope 缺失**

**修复路径**：更换 token 使其包含 applications 编辑权限，或负责人在浏览器里直接创建。

## 九、2026-09-22 无障碍路径 (fast path)

**当前 staging Zero Trust 账户配置**：
- **Zero Trust Team Domain**: `https://steep-violet-bb7f.cloudflareaccess.com`
- **ACCESS_JWT_ISSUER** 应填： `https://steep-violet-bb7f.cloudflareaccess.com`
- **ACCESS_JWKS_URL**: `https://steep-violet-bb7f.cloudflareaccess.com/cdn-cgi/access/certs`
- **ACCESS_JWT_AUDIENCE**：需要建一个 Application 后才能生成 (AUD Tag)

### B 组向导 Stage 5 的三值填法（老板当前状态没有 Access apps）：

1. `field: issuer` = `https://steep-violet-bb7f.cloudflareaccess.com`
2. `audience` = `<未填>` — 依赖创建并指向 `/api/admin/*` 的 Access App
3. `jwks_url` = `https://steep-violet-bb7f.cloudflareaccess.com/cdn-cgi/access/certs`

### 另请熟知
- 当前负责人 token (cfut_wCgbmQDnK…) 没有 Access 编辑 scope，POST /access/apps 返回 1010 auth.forbidden；
- 需重新生成一个包含 Access: Edit scope 的 token 或**手动在面板上建 Access 应用**；
- 一旦拿到 token 我osc可自动保全 Access Application + 3 policies + **装遣测试身份**（Consumer via email）。

## 十、2026-09-22 二次 token spike（负责人发给的 `cfat_` 账号 token）

实测结果：`cfat_5K26edJRE…（已于开源前撤销）` 为 **Cloudflare Account 用户的读-API token**，
并非一个可 REST 用的**完整 Cloudflare One Access 编辑范围**对比头列表与 POST：

- GET `/access/organizations` ✅ 200 → Zero Trust 读写 quota OK，auth_domain = steep-violet-bb7f.cloudflareaccess.com
- GET `/access/groups` → ✅ 200 空
- GET `/access/apps` → ✅ 200 空
- POST `/access/apps` → ❌ **1010 auth.forbidden**
- POST `/access/applications` → ❌ 10001

结论：负责人当前 token scope 里 Access 是 **Read** 而非 Edit，因此不能通过 cf-api 创建 Access application。
**负责人需要在 Cloudflare Zero Trust 面板手动做 Access Application **或**发放一个
`Access > Applications & Policies > Edit` (Account scope) 权限 token**。cloudflare-one skill
可以据此时的 API来做，但 token 必须是 Access-scoped。

### 手动步骤（负责人一关即可完成）
- Zero Trust → Access → Applications → Add Application
- Application domain: <your-staging-URL>/api/admin
- Application Audience (AUD tag) → 副本
- 3 policies: viewer / editor / publisher
- Team domain 与 JWKS URL 从 application 页复制
填写后 .env 里 ACCESS_JWT_* 三值 + staging wrangler deploy 前三项读出即生效。

## 十一、2026-09-22 第三次 token spike（负责人发的 `cfat_L8Qn…`）

实测：新 token 权限范围包括 **Access: Apps and Policies Read / Write / Revoke / Policies Read / Policies Write**
（从 token types 列表看具备 C 组准许），但实际 Endpoint 测试仍返回：
- `/access/organizations` → 403 "Authentication error"
- `/access/applications` → 404 "Unable to authenticate request"
- 也就是说: Account-scoped api_token 从 **Zero Trust API 的接口不识别**。这是因为 Zero Trust read/write 的
  Cloudflare One Business policy 是通过 Cloudflare Zero Trust dashboard 去手动的页面，不可通过 API
  Client API 的 Account key 种（而可以用 **service tokens** via `X-Access-Client-Id/Secret`）。

**建议的执行步骤**：Cloudflare Dashboard 里手工完成以下 → 发**三值**即可。

## 十二、Dashboard 手动 3 步流程（当前推荐）

步骤一：**打开** https://one.dash.cloudflare.com/ → Access → Applications → Add Application → Self-hosted
步骤二：填:
  - Application name: ENSO Monitor Admin (staging)
  - Application domain: enso-monitor-staging.<YOUR-SUBDOMAIN>.workers.dev/api/admin
  - Session duration: 24h
步骤三：往后走 Add Policy 三条（Allow / Inbox），各占 editor / viewer / publisher 三个测试身份
步骤四：保存后从 Application 主页复制 AUD/JWT/Issuer 三个值，写入 `.dev.vars` （or dashboard 里）：
   ACCESS_JWT_ISSUER = https://steep-violet-bb7f.cloudflareaccess.com
   ACCESS_JWT_AUDIENCE = (Application AUD)
   ACCESS_JWKS_URL = https://steep-violet-bb7f.cloudflareaccess.com/cdn-cgi/access/certs
   # 然后用 npx wrangler secret put ACCESS_* --env staging 或直接跑 npm run local:seed:probe
