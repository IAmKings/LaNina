#!/usr/bin/env bash
# 把 main 的内容发布为公开快照 → github.com/IAmKings/LaNina（origin/main）
#
# 用法：
#   bash scripts/publish-public-snapshot.sh "ENSO 市场监测 vX.Y（摘要）"
#   bash scripts/publish-public-snapshot.sh --scan-only      # 只做敏感扫描
#
# 约定（2026-09-25 更新）：
#   * 开发只在 main 上进行；main 及其完整历史**不推送**。公开分支是 gh-clean（与 main 无共同祖先），
#     内容 = main 的工作树
#           + 公开专属文件（LICENSE / .dev.vars.example / docs/usage/ / local/）
#           − 私有会话记录（.trellis/workspace/kuluoluo/{index.md,journal-1.md} 保留公开分支的裁剪版）。
#   * 推送前做敏感扫描（0 命中）。规则串所在的脚本自身会被跳过（否则自指误报）。
#   * 推送用 `git push origin gh-clean:main`：正常情况下是快进；只有公开分支被重写过才需要 -f。
set -euo pipefail

cd "$(dirname "$0")/.."

PUBLIC_BRANCH="gh-clean"
SCAN_ONLY=0
if [[ "${1:-}" == "--scan-only" ]]; then
  SCAN_ONLY=1
  shift
fi
NEW_MSG="${1:-"ENSO 市场监测（公开快照）"}"

# 公开分支上保留、不从 main 回灌的文件（逐行）
KEEP_FILES=".trellis/workspace/kuluoluo/index.md
.trellis/workspace/kuluoluo/journal-1.md"

log() { printf '%s\n' "$*"; }

log "[1/6] 当前分支：$(git branch --show-current)"
if [[ "$SCAN_ONLY" != "1" ]]; then
  if [[ "$(git branch --show-current)" != "main" ]]; then
    log "❌ 请先切回 main"; exit 1
  fi
  if [[ -n "$(git status --porcelain)" ]]; then
    log "❌ 工作区不干净，请先在 main 上提交"; exit 1
  fi
fi

log "[2/6] 敏感扫描（0 = 通过）"
# 规则串本身就在下面的变量里；扫描时跳过承载规则串的脚本，避免自指误报。
SECRET_PATTERNS="cfat_[A-Za-z0-9]{20,}|cfut_[A-Za-z0-9]{20,}|KNJKYgbl|HyUMSG|af42922d|fde397a0|38dWjo|0ec40cf3|0d2e707d|w496830083|[a-z0-9._]+@gmail\.com"
SELF_SCAN="^(scripts/publish-public-snapshot\.sh|local/publish-gh\.sh|local/pre-publish-scan\.sh)$"
hits=0
while IFS= read -r f; do
  [[ -z "$f" ]] && continue
  if [[ "$f" =~ $SELF_SCAN ]]; then continue; fi
  h=$(grep -cI -E "$SECRET_PATTERNS" "$f" 2>/dev/null || true)
  if [[ -n "$h" && "$h" != "0" ]]; then
    log "❌ 敏感内容：$f（$h 行）"
    hits=$((hits + h))
  fi
done < <(git ls-files)
if [[ "$hits" != "0" ]]; then
  log "❌ 共 $hits 行敏感内容，已中止"; exit 1
fi
for secret in .dev.vars .env; do
  if [[ -f "$secret" ]] && ! git check-ignore -q "$secret"; then
    log "❌ $secret 未被 .gitignore 忽略"; exit 1
  fi
done
log "  ✓ 0 tokens / 0 keys / 0 emails"
if [[ "$SCAN_ONLY" == "1" ]]; then
  log "✅ 仅扫描模式，结束"
  exit 0
fi

log "[3/6] 切到 $PUBLIC_BRANCH 并同步 main 的工作树"
git checkout -q "$PUBLIC_BRANCH"
git checkout main -- .
# 私有会话记录：保留公开分支上已裁剪的版本，绝不回灌 main 的私有内容
while IFS= read -r keep; do
  [[ -n "$keep" ]] && git checkout HEAD -- "$keep"
done <<< "$KEEP_FILES"
# 删除公开分支上已不存在于 main 的文件，但保留公开专属文件
git ls-tree -r --name-only HEAD | sort > /tmp/.publish-public-branch-files
git ls-tree -r --name-only main | sort > /tmp/.publish-main-files
while IFS= read -r stale; do
  [[ -z "$stale" ]] && continue
  case "$stale" in
    LICENSE|.dev.vars.example|docs/usage/*|local/*) continue ;;
  esac
  git rm -q -f --ignore-unmatch "$stale"
done < <(comm -23 /tmp/.publish-public-branch-files /tmp/.publish-main-files)

log "[4/6] 提交快照"
git add -A
if git diff --cached --quiet; then
  log "  ✓ 与公开分支无差异，跳过提交"
else
  git commit -q -m "$NEW_MSG"
fi

log "[5/6] 推送 origin/main"
git push origin "$PUBLIC_BRANCH:main"

log "[6/6] 回到 main"
git checkout -q main
log "✅ 公开仓库已更新到 $(git log --oneline "$PUBLIC_BRANCH" | head -1)"
