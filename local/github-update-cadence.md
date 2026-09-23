# GitHub 公开仓库更新节奏（本地私有，不上传）

> 本文件位于 `local/`（gitignored），永不上传。公开仓库 = 单 commit 快照策略，
> 本地 `main` 的 107+ 个人 journal / Trellis 工作流**不上传**。

## 一、仓库拓扑

| 位置 | 内容 | 性质 |
|---|---|---|
| 本地 `main` | 107+ 私有工作日志 commit（含 `.trellis/` journal） | **不上传** |
| 本地 `gh-clean` | 单 commit 快照（orphan squash），零敏感 | 公开的 staging |
| `origin/main` | `gh-clean` 的推送镜像 | 他人可见 |
| 真实密钥 | `.dev.vars`（gitignored） / `wrangler secret` | 永不上传 |

## 二、标准更新节奏（每次功能合并到 main 后 1 分钟）

```bash
cd /Users/pauldeman/Documents/ai_workspace/LaNina

# 1) 切到公开快照分支
git checkout gh-clean

# 2) 把 main 内容 squash 进来（--squash 不会带出 main 的历史）
git merge --squash main --allow-unrelated-histories -m "ENSO 市场监测 v<N+1>"

# 3) 同步 .gitignore 里 private/（local/ 等）之外的一切后，确认零敏感
bash local/pre-publish-scan.sh        # 0 = 可以推
git commit -q --amend --no-edit       # 或 git commit -q -m "..."

# 4) 强制替换 origin/main 的单 commit
git push -f origin gh-clean:main

# 5) 回到私有工作分支持续工作
git checkout main
```

### 初始一次性脚本（已可用）
```bash
bash local/publish-gh.sh   # 自动完成上述 1-5 步（安全前扫 + 强推）
```

## 三、开源版的安全底线（每次推送前必须全部为 0）

| 扫描目标 | 检查 |
|---|---|
| 任何 32 位 token（`cfat_*` / `cfut_*`） | ❌ 0 |
| 业务密钥（EIA/USDA/Census/UNCTAD/Access 三值） | ❌ 0 |
| `.dev.vars` / `.env` 类文件 | ❌ gitignored 之外不出现在 tree |
| Cloudflare Account ID / email / workers.dev 子域 | ❌ 0（占位符化） |
| staging/production URL 品名 | 🟢 允许（纯资源标识） |

扫描脚本（防误推送上一轮的 token 回归）：见 `local/pre-publish-scan.sh`

## 四、`origin/main` 单 commit 的历史理念

`--force` 只覆盖「最新的那个快照 commit」——不会暴露任何过去快照的 token。
每次 push 前单 commit 重新打包，历史**永远只有 1 个 commit**。

## 五、如果真的需要临时公开更多细节（例如蚌的 PRD）

把相应文件从 `.gitignore` 解除并加入 gh-clean 之前先人工读一遍；
含密钥/token 的文件**永不**进 gh-clean。

## 六、更新节奏建议

| 节奏 | 内容 |
|---|---|
| 每周（可选） | 把 main 的新增功能 squash → `gh-clean` → `push -f` |
| 立即（触红线） | 任何 `.dev.vars` 出现的新 key → 重新校验 git 状态 |
| 每次 | `local/pre-publish-scan.sh` 必须 0 |

## 七、如果 `origin/main` 已经上传过敏感内容

1. `git push -f origin:main`（用更深 clean commit 覆盖）
2. 立刻在 Cloudflare dash ROLL 所有在本地 `.dev.vars` 里用过的 token
3. GitHub 后台联系 support 清除 orphaned commit 缓存（`git push` 时有 expire 指令，实测可过 24h 后 GC）

保持高强度的 token 卫生习惯，比 patch 历史更省事。
