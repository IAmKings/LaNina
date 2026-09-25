#!/usr/bin/env bash
# 清理 staging 上误应用的 TEST ONLY 演示数据（seeds/9001_test_only_local_demo_publication.sql）。
#
# 这是**破坏性**操作（会删除演示行并临时摘下 4 个删除保护触发器，随后立即恢复）。
# 用法：
#   bash scripts/cleanup-staging-demo-rows.sh --yes
#
# 步骤：备份 → 执行 scripts/cleanup-staging-demo-rows.sql → 断言残留为 0、触发器已恢复。
# 逻辑已在真实 SQLite 上按 staging 同形状回归（src/worker/adapters/storage/demo-rows-cleanup.test.mjs）。
set -euo pipefail

cd "$(dirname "$0")/.."

DATABASE="enso-monitor-staging"
APP_ENV="staging"
SQL_FILE="scripts/cleanup-staging-demo-rows.sql"

if [[ "${1:-}" != "--yes" ]]; then
  cat <<'USAGE'
用法: bash scripts/cleanup-staging-demo-rows.sh --yes

会先备份然后再删除 staging 上的 local-demo-* 行与 2026-09-11 合成日报。
备份输出到 .local-evidence/backups/（该目录被 .gitignore 忽略）。
USAGE
  exit 1
fi

[[ -f "$SQL_FILE" ]] || { echo "❌ 缺少 $SQL_FILE"; exit 1; }

mkdir -p .local-evidence/backups
STAMP="$(date -u +%Y%m%dT%H%M%SZ)"
BACKUP=".local-evidence/backups/${DATABASE}-${STAMP}.sql"

echo "[1/3] 备份 → $BACKUP"
npx wrangler d1 export "$DATABASE" --remote --env "$APP_ENV" --output "$BACKUP" --skip-confirmation

echo "[2/3] 执行清理 $SQL_FILE"
set +e
npx wrangler d1 execute "$DATABASE" --remote --env "$APP_ENV" --file "$SQL_FILE" --json > /tmp/.cleanup-staging-demo-rows.json
STATUS=$?
set -e
if [[ "$STATUS" != "0" ]]; then
  echo "❌ 清理执行失败（退出码 $STATUS）。触发器可能处于摘除状态，请**立即**重跑本脚本（脚本幂等），"
  echo "   或单独执行：npx wrangler d1 execute $DATABASE --remote --env $APP_ENV --file $SQL_FILE"
  exit "$STATUS"
fi

echo "[3/3] 断言残留与触发器"
node -e '
const fs = require("fs");
const raw = fs.readFileSync("/tmp/.cleanup-staging-demo-rows.json", "utf8");
let parsed;
try { parsed = JSON.parse(raw); } catch { console.error("❌ 无法解析 wrangler --json 输出"); process.exit(1); }
const rows = (Array.isArray(parsed) ? parsed : [parsed]).flatMap((item) => item.results ?? []);
const summary = rows[rows.length - 1] ?? {};
const expectedKeys = ["demo_versions","demo_observations","demo_evidence","demo_changes","demo_runs","demo_pointers","demo_brief"];
const bad = expectedKeys.filter((key) => Number(summary[key]) !== 0);
if (bad.length > 0) {
  console.error("❌ 仍有演示数据残留:", JSON.stringify(summary));
  process.exit(1);
}
if (Number(summary.restored_triggers) !== 4) {
  console.error("❌ 删除保护触发器未全部恢复:", JSON.stringify(summary));
  process.exit(1);
}
console.log("✅ 清理完成:", JSON.stringify(summary));
'
echo "备份保留在 $BACKUP"
