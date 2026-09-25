#!/usr/bin/env bash
# 兼容入口（2026-09-25）：敏感扫描已并入 scripts/publish-public-snapshot.sh 的 --scan-only，
# 扫描规则串不再自我阻断，且可在任意分支运行。
# 用法：bash local/pre-publish-scan.sh
set -euo pipefail
exec "$(cd "$(dirname "$0")/.." && pwd)/scripts/publish-public-snapshot.sh" --scan-only
