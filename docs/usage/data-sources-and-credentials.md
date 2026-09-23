# 数据来源与凭据

12 家公开数据源的许可模型与凭据的获取入口。所有公开指标的生产种子已冻结
（seeds/0001–0007），每一条来源的许可评估见 [docs/operations/source-release-register.md](operations/source-release-register.md)。

## 免密钥（零成本自动采集）

| 来源 | 权利 | 所在adapter |
|---|---|---|
| NOAA Climate Prediction Center RONI | 公开数据（CC0 组件标准） | `noaa-roni` |
| NASA Langley POWER | 公开 API（自动访问/私有留存/派生显名） | `nasa-power-regional-rainfall` ×4 区域 |
| World Bank Pink Sheet | CC BY 4.0（数据集级 exact-value 复核） | `world-bank-pink-sheet` |
| JPX 大阪交易所橡胶当日 CSV | indexium.index 发布（私有留存+派生公开） | `jpx-ose-settlement` |

## 需要 API key（都可免费申请）

| 来源 | 申请入口 | 适配器 |
|---|---|---|
| EIA Brent Spot | https://www.eia.gov/opendata/register | `eia-europe-brent-spot` |
| USDA FAS PSD | https://api.data.gov/signup | `usda-fas-psd`（Malaysia Palm Oil / South Africa Corn）|
| U.S. Census Intl-Trade | https://api.census.gov/data/key_signup.html | `usa-census-intltrade`（6 个 USEC 港口）|
| UNCTAD Data Hub LSCI | https://unctadstat.unctad.org/datacentre/ 注册后发 ID | `unctad-lsci`（CC BY 3.0 IGO）|

### 凭据的运行时位置

- **本机采集**（`npm run local:collect`）：读取 `.dev.vars`（gitignored，模板见[`.dev.vars.example`](../.dev.vars.example)）
- **staging / production Worker**（自动每天采集）：`npx wrangler secret put <NAME> --env staging`，key 名与 `.dev.vars` 同名
- **README / git 历史里没有**真实密钥；`B组向导`（`scripts/cloudflare-staging-provision.sh`）会自动生成

### 商业来源（未接入，本地逐条询价）

[docs/operations/a-group-procurement-plan.md](operations/a-group-procurement-plan.md) 里的 6 家商业源
(SGX/SHFE/INE · FBX/Drewry/Xeneta · GLP · MRB · ACP) 全部**未接**；只能以询价文/公开试用为限；
在未书面授权前系统对相关论点返回"数据覆盖不足"（fail-closed）而不是用替代源。

## Cloudflare 部署层凭据

- **Wrangler OAuth**（`npx wrangler login`）本地 deploy 即可，无需 API token。
- **无头部署/CI** 需要 `CLOUDFLARE_API_TOKEN`（模板：Edit Cloudflare Workers + D1 + R2）。
- **staging Access 后台**三值（`ACCESS_JWT_ISSUER` / `AUD` / `JWKS_URL`）由 B/C 组向导或
  ManualizingCloudflare 面板（Zero Trust → Applications）产生，`wrangler secret put` 注入。
