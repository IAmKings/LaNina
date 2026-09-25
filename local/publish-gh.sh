#!/usr/bin/env bash
# 兼容入口（2026-09-25）：公开快照发布已移到 scripts/publish-public-snapshot.sh，
# 以便直接从 main 运行（local/ 在 main 上被 .gitignore 忽略，脚本无法常驻）。
# 用法：bash local/publish-gh.sh "ENSO 市场监测 vX.Y（摘要）"
set -euo pipefail
exec "$(cd "$(dirname "$0")/.." && pwd)/scripts/publish-public-snapshot.sh" "$@"
