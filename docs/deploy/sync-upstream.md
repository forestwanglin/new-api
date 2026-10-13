# 长期跟踪 upstream：分支管理与升级流程

fork 长期跟踪 upstream 的核心矛盾：既要持续吸收上游更新，又要保住自己的定制，且每次升级的冲突成本要可控。

## 1. 核心原则：定制要"可枚举、可隔离"

分支策略再巧，也救不了散落在 50 个文件里的改动。升级冲突成本 = 你改动的文件 × upstream 改同一文件的概率。所以：

- **优先新增文件，少改存量文件。** 比如"自定义 CSS"方案：后端加一个 setting 字段 + 前端布局里注入 `<style>`，页面组件一个都不碰 → 升级时几乎零冲突。
- **必须改组件时，改动收敛在独立文件。** 例如重设计 pricing 页，尽量把新 UI 写成新组件文件，原文件只留一个"开关/替换点"（一行 import 或条件渲染），而不是把原文件改得面目全非。
- **维护一份定制清单（如 `FORK-CUSTOMIZATIONS.md`）：** 每个定制点记录改了哪些文件、为什么、对应哪个需求。每次升级后逐项回归验证。这是 fork 维护里最值钱的一份文档。

## 2. 分支模型

```
upstream/main ──┐
                ├─► main   （纯上游镜像，永远只 fast-forward，不放任何定制代码）
                │
main ──────────┴─► zyy     （开发分支 = main + 自己的改动，日常开发都在这里）
                        │
                        └─► feat/xxx  （临时功能分支，完成后合回 zyy）
```

- **main = 上游镜像：** 只执行 `git merge --ff-only upstream/main`，永远干净。好处：随时能 `git diff main zyy` 看到"我们到底改了什么"，也能先验证纯上游版本可构建。
- **zyy = 交付分支：** 所有定制代码，部署构建都从它出（部署流程见 [deploy-zyy-branch.md](deploy-zyy-branch.md)）。
- 临时需求开 `feat/*` 分支，完成后合入 `zyy`，避免 `zyy` 上直接堆未完成的改动。

备选：如果团队就一个人、且希望历史线性，可以让 `zyy` 直接当主分支、定期 merge upstream。但"main 镜像 + zyy 定制"的双分支模型在升级排障时清晰得多，推荐前者。

## 3. 升级流程（每次 upstream 有更新时）

```bash
# ① 同步镜像分支
git checkout main
git fetch upstream
git merge --ff-only upstream/main
git push origin main

# ② （建议）先验证纯上游可构建：web 构建 + go build + 跑 CI
#    确认上游本身没问题，排除"上游坏了"的干扰

# ③ 把更新带进开发分支
git checkout zyy
git merge main          # 产生一个 "sync upstream xxx" merge commit
# 解决冲突（应该只出现在定制清单里的文件）

# ④ 回归验证：前端 build + 单测 + 定制清单逐项检查
cd web && bun install && bun run build && bun run test && cd ..
go build .

# ⑤ 打 tag 并推送
git tag v1.x.x-fork.1
git push origin zyy --tags
```

注意：`bun run test` 执行的是 `web/package.json` 里的 `test` 脚本（即 `vitest run`）；`bun test` 是 bun 自带测试运行器，不会跑项目的 vitest 用例。

推送后，如果服务器已在运行旧版本，按 [deploy-zyy-branch.md](deploy-zyy-branch.md) 第十步更新部署（备份 → 拉取 → 重建 → 重建容器）；线上用户较多、不能接受中断时，按 [zero-downtime-update.md](zero-downtime-update.md) 的蓝绿切换流程更新。

**merge 还是 rebase？** 推荐 merge（main 合入 zyy）：

- 不重写 zyy 的提交历史，多人协作或误操作时可恢复；
- 每个 merge commit 天然标记"一次上游同步"，`git log --merges` 就能列出升级时间线；
- 冲突集中在这一次 merge 里解决，边界清晰。

rebase 只在"zyy 分支只有你一人用、且强烈要求线性历史"时才考虑，且升级前先打备份 tag。

## 4. Tag / 版本策略

- upstream 的 tag（如 `v0.13.2`）不要复用，避免混淆。
- fork 版本用独立命名，例如 `v0.13.2-fork.1`（基于的上游版本 + fork 序号），tag 打在 `zyy` 分支上。
- 部署时记录"main 分支 commit + zyy commit"两个点，出问题可以分别回退。

## 5. CI 配合

- 现有 `ci.yml` 由 `pull_request` 触发，天然覆盖指向 `zyy` 的 PR；直接 push 到 `zyy` 不会跑 CI，建议一律走 PR 合入（同时启用下面的改动面检查）。
- 加一个轻量检查：`zyy` 分支的 PR 合并前，CI 跑 `git diff main...zyy --name-only`，把改动文件列表贴到 PR 评论里——强制"改动面可视化"，防止定制悄悄扩散。
- 升级 merge 的 PR 描述里贴定制清单核对结果。

## 6. 一个容易踩的坑

upstream 大版本升级时（落后提交数较多时），不要一次性跨太多版本。如果 upstream 有 release 节奏，尽量小步同步（每次几十个提交），冲突好定位；跨大版本时先在 main 镜像上验证构建，再进 zyy。

---

**总结成一句话：** main 做纯上游镜像、zyy 做定制交付分支、小步 merge 同步、定制改动尽量收敛成"新增文件 + 单点替换"、用 `FORK-CUSTOMIZATIONS.md` 管理定制清单并逐项回归。
