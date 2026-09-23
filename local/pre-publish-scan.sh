#!/usr/bin/env bash
# 推送前的敏感扫描（0 = 通过可推送）
# 用法：bash local/pre-publish-scan.sh
set -euo pipefail
cd "$(dirname "$0")/.."

BR=$(git branch --show-current)
if [[ "$BR" == "gh-clean" ]]; then
  TARGET_FILES=$(git diff --cached --name-only 2>/dev/null || true)
  REF="--cached"
else
  git fetch origin main -q 2>/dev/null || true
fi

# 对 gh-clean 快照树（本地分支 HEAD）扫描
SECRET_PATTERNS="cfat_[A-Za-z0-9]{20,}|cfut_[A-Za-z0-9]{20,}|KNJKYgbl|HyUMSG|af42922d|fde397a0|38dWjo|0ec40cf3|0d2e707d|w496830083|[a-z0-9._]+@gmail\.com"

hits=0
for f in $(git ls-files); do
  h=$(grep -cI -E "$SECRET_PATTERNS" "$f" 2>/dev/null || true)
  if [[ "$h" != "0" ]]; then
    echo "❌ $f 有 $h 行敏感内容"
    hits=$((hits + h))
  fi
done

if [[ "$hits" == "0" ]]; then
  echo "✅ 扫描通过（0 tokens/keys/emails）"
  exit 0
else
  echo "❌ $hits 行敏感内容，推 push 前必须清理"
  exit 1
fi
