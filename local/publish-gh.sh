#!/usr/bin/env bash
# 单 commit 快照 → github.com/IAmKings/LaNina（main，强推）
# 用法：bash local/publish-gh.sh "<commit message>"
# 本脚本只在本地 main 分支上工作后切换；不在公开 repo 露任何 personal 信息。
set -euo pipefail

cd "$(dirname "$0")/.."

NEW_MSG="${1:-"ENSO 市场监测（公开快照）"}"

echo "[1/5] 当前分支（应 main）：$(git branch --show-current)"
if [[ "$(git branch --show-current)" != "main" ]]; then
  echo "❌ 请先切回 main"; exit 1
fi

echo "[2/5] 敏感扫描（必须 0）"
while IFS= read -r f; do
  [[ -z "$f" ]] && continue
  hits=$(grep -cI -E "cfat_[A-Za-z0-9]{20,}|cfut_[A-Za-z0-9]{20,}|KNJKYgbl|HyUMSG|af42922d|fde397a0|38dWjo|0ec40cf3|0d2e707d|w496830083" "$f" 2>/dev/null || true)
  if [[ -n "$hits" && "$hits" != "0" ]]; then
    echo "❌ 发现敏感行：$f（hits=$hits）"; exit 1
  fi
done < <(git ls-files)
echo "  ✓ 0 tokens / 0 keys"
# 未追踪的密钥文件不入 gh-clean
for secret in .dev.vars .env; do
  if [[ -f "$secret" ]]; then
    if ! git check-ignore -q "$secret"; then
      echo "❌ $secret 不在 .gitignore — 修好后重跑"; exit 1
    fi
  fi
done

echo "[3/5] 切到 gh-clean 并 squash main"
git checkout gh-clean
git add -A
git commit -q -m "pre-publish scan checkpoint" 2>/dev/null || true
git merge --squash main --allow-unrelated-histories -m "$NEW_MSG"

echo "[4/5] 强推 origin/main（单 commit）"
git push -f origin gh-clean:main

echo "[5/5] 回到 main"
git checkout main
echo "✅ 公开仓库已更新到 $(git log --oneline gh-clean | head -1)"
