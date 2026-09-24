# Linux arm64 Desktop 打包接手说明

> For English-speaking agents: this is the handoff summary for the Kylin/Linux arm64 portable deliverable. Authoritative build steps live in `apps/desktop/README.md` (`### Linux arm64 portable build`); this file adds the session-derived state, script inventory, delivery mechanics, and known traps.

本文件写给**接手这个交付物的下一个 agent**。产品文档（怎么构建）在 `apps/desktop/README.md`；这里记录"现在处于什么状态、脚本在哪、坑在哪、先做什么"。

## 1. 交付物定义

| 项 | 约定 |
|---|---|
| 目标机 | 麒麟 V10 SP1+（glibc 2.28 实测），arm64，内网离线 |
| 形式 | **便携 tar.gz**（不是 AppImage/deb）：解压即用，含启动脚本、freedesktop 入口安装脚本、bundle 内 README |
| 更新 | portable 通道**不带**自动更新 feed，也不带强制更新策略 |
| 运行依赖 | 自带 Electron、primary runtime（Node/pnpm/Python）、Office 引擎；不依赖系统 Node |

## 2. 先读哪些文件（按优先级）

| 路径 | 作用 |
|---|---|
| `apps/desktop/README.md` → `### Linux arm64 portable build` | **权威**构建步骤、产物路径、运行方式 |
| `.github/workflows/desktop-linux-arm64.yml` | 当前 CI 通道（另有旧的 `portable-linux-arm64.yml`，仅存档） |
| `apps/desktop/scripts/package-linux-arm64-portable.ts` | 打包器本体（launcher、入口安装脚本、bundle README 都在这个文件里） |
| `apps/desktop/scripts/electron-builder-config.mjs` | `asar: !portable`、`linux.target=['dir']`、`extraResources`、`electronLanguages` 等 |
| `AGENTS.md`、`docs/testing.md` | 仓库通则与测试政策（改动前必读） |

## 3. 本机构建（Windows 开发机）

```powershell
cd D:\code2609\gitClones\deepseek-harness
$env:CI='true'                                  # 跳过 lefthook postinstall
$env:DSH_DESKTOP_PNPM_STORE_DIR='D:\.pnpm-store\v11'   # 复用已缓存 pnpm store，准备阶段不再全量重下
pnpm --dir native/system run build:ts            # package-target 加载时 import 原生包，需先有 JS
pnpm --dir apps/desktop run package:linux:arm64:portable
```

产物：`apps/desktop/.desktop-build/targets/linux-arm64/portable/<bundleName>.tar.gz`（同名 `.sha256`）。

本机注意事项：

- **不要执行 `pnpm run clean`**：会删掉整个 `.desktop-build`（含已交付安装包与覆盖更新包）。回收空间只删 `targets/`。
- D: 盘常只剩几 GB；可把中间产物换到大盘：`cmd /c mklink /J apps\desktop\.desktop-build\targets E:\dsh-desktop-targets`。
- 本机沙箱里 **git 钩子跑不了**（msys `sh.exe` 崩），提交/推送加 `--no-verify`；另外 `apps/web` 的 vite/esbuild 会在"写完临时文件立刻删"时被拒（用你自己的终端跑，或给 Defender 加排除项）。
- Linux 目标在 Windows 上只能"打包"，不能"运行验证"；运行验证只能在麒麟机或 CI 冒烟里做。

## 4. CI 构建（推荐路径）

```powershell
# 通用助手：分发 → 等待 → 下载产物 → 打印每个步骤耗时
pwsh -File apps/desktop/docs/linux-arm64-desktop/ci-run.ps1 -Workflow desktop-linux-arm64.yml -Ref master
```

- 分发需要仓库默认分支上的 workflow（GitHub 只允许从默认分支 dispatch）。
- 预期 12–20 分钟；`Build the unsigned …`（Linux 通道对应步骤）内部阶段耗时基线（run 实测）：

| 阶段 | 量级 | 说明 |
|---|---|---|
| 仓库构建（host+client+web） | 3–4 min | `build:official`，不可省 |
| `release:pack --family dsh` | 2–3 min | 把工作区打成 tarball，保证运行时=发布字节 |
| `prepare:runtime` | 1–2 min | 下载/解压 Electron、Node、Python、wheels（有缓存则更快） |
| `prepare:dsh` | 2–4 min | 安装闭包 + 物化（含一次 Office 冒烟） |
| electron-builder | 2–5 min | 组装 win-unpacked/linux-unpacked + 压缩 + blockmap + 打包后冒烟 |

## 5. 产物结构（tar.gz 解压后）

```
<name>/
  run-deepseek-harness.sh          # 启动器：Chromium 抗节流 flags + --class=deepseek-harness
  install-desktop-entry.sh         # 写 deepseek-harness.desktop（Terminal=false）并注册 + 放桌面副本
  README.md                        # bundle 内使用说明（由打包器生成）
  resources/
    app/                           # ← 明文目录（asar:false），可直接改文案/版本
      lib/main.js                  # 壳入口（可替换，覆盖更新包就是换它）
      package.json                 # app.getVersion() 的版本来源
      renderer/, dsh/ …
    icon.png                       # 打包态图标（窗口/桌面入口用）
    app-icon.png                   # 入口脚本 Icon= 指向的方形图标（由打包器从 resources/icon.png 复制）
    runtime/primary-runtime/       # 自带 Node/pnpm/Python + Office 技能资源
  locales/, *.dll, deepseek-harness(可执行) …
```

## 6. 脚本清单（按执行顺序）

| 脚本 | 职责 | 关键输入 |
|---|---|---|
| `apps/desktop/scripts/package-linux-arm64-portable.ts` | 打包器：调用 pnpm 跑准备链，rename electron-builder 产物为 bundle，写 launcher / 入口安装脚本 / README，打 tar.gz + sha256 | `DSH_DESKTOP_PORTABLE=1`（脚本内部设置）、`DSH_DESKTOP_APP_ID`、`.env.windows`/环境变量 |
| `.github/workflows/desktop-linux-arm64.yml` | CI 通道：构建 + 上传 artifact（可选发 Release） | `workflow_dispatch` 输入 |
| `apps/desktop/scripts/prepare-runtime.ts` | 下载/解压 Electron + 准备 primary runtime（Node/pnpm/**Python**）+ `versions.json` | `DSH_DESKTOP_PNPM_STORE_DIR` 影响下游安装；下载缓存在 `.desktop-build/downloads` |
| `apps/desktop/scripts/prepare-primary-runtime.ts` → `scripts/primary-runtime/prepare.ts` | 物化 primary runtime；**Python 载荷裁剪**（Tk/Tcl、idlelib、ensurepip、lib2to3、test、`__pycache__`）在这里 | `scripts/primary-runtime/lock.json`（版本 pin） |
| `apps/desktop/scripts/prepare-package-set.ts` / `prepare-dsh.ts` | 生成包集 → 安装生产闭包 → 物化 → 清单/校验 → 冒烟 | `DSH_DESKTOP_PNPM_STORE_DIR` |
| `apps/desktop/scripts/smoke-packaged-runtime.ts` | 冒烟：DOCX/XLSX/PPTX→PDF + skill CLI 探测 | Windows 下走 `short-application-path.ts`；Linux 用 `linux-arm64-unpacked` |
| `apps/desktop/scripts/brand-assets.mjs` | 构建时品牌注入：读 `DSH_DESKTOP_BRAND_ARCHIVE[_BASE64]` → 白名单校验 → 覆盖源文件 → 返回还原函数（两个打包入口都挂） | 品牌资产 zip/目录（备份在 `.desktop-build/branding-backup/`） |
| `apps/desktop/docs/linux-arm64-desktop/ci-run.ps1` | 本目录：分发/等待/下载/耗时打印 | `-Workflow -Ref -InputsJson -DownloadDir` |

## 7. 覆盖更新包（避免重发 ~360 MB）

机制：只替换 bundle 内的少量路径，用一个小 tar.gz + 安装脚本覆盖。

- 现有产物：`apps/desktop/.desktop-build/` 下的 `update-work-*/` 目录（含 payload 与生成物；**不要删**）。已替换过 9 个路径，含 `resources/app/lib/main.js`、入口脚本、欢迎页品牌资源、README 等。
- 安装脚本行为：备份被替换文件 → 覆盖 → 保持可执行位（launcher/入口脚本 0755）。
- 生成方式：改源码后**只重建壳**（`pnpm --dir apps/desktop exec tsdown`，约 2 秒），把产物与需要的静态文件按相对路径放进一个 tar.gz，附一个带 sha256 校验与备份逻辑的 `install-update.sh` 即可；不需要重跑 electron-builder。

## 8. 已知坑（都踩过）

| 现象 | 根因 / 处理 |
|---|---|
| Kylin 下菜单 "Edit" 是英文而"应用"是中文 | 裸 `role:'editMenu'` 的标题/子项由 Electron 按 **Chromium 语言**本地化，与壳字典来源不同。**已修**（`main.ts` 用字典自建编辑菜单；右键菜单也走字典）。临时不改包可用 `run-deepseek-harness.sh` 加 `--lang=zh-CN` |
| 连接状态反复"重新连接中/连接成功"、Office 预览被中断 | 网关心跳在慢宿主上误杀健康连接。桌面叠加配置 `apps/desktop-host/desktop-defaults.patch.yml` 把 `websocketHeartbeatIntervalMs` 调大；launcher 加抗节流 flags |
| Office 预览失败（docx/pptx "signal is aborted"、xlsx 转圈） | LibreOfficeKit 原生引导受 `MAX_PATH` 限制：**应用路径要短**；打包侧已加超时/大小上限，Windows 侧有短路径重定位 |
| asar 相关失败 | Linux 便携通道刻意 `asar:false`：Electron 的 asar 对缺失路径返回 `null`（不是 `undefined`），会破坏 kit 的 WASM 回退判断 |
| 体积 | 已做：语言包只留 `en-US`/`zh-CN`、Python 载荷裁剪（合计 −16.7 MB 压缩后）、`compression=maximum` 对 NSIS **实测无效**（282.3 vs 282.4 MB） |
| 速度 | 已做：pnpm store 与 downloads 缓存真正落地、逐阶段耗时打印、壳构建不再重复 `tsc -b`（180s → 2s） |
| 品牌美术 | 仓库只保留**上游**美术；我方品牌改由**构建时注入**——**已实现**（2026-09-24）：`DSH_DESKTOP_BRAND_ARCHIVE`（zip 文件或同布局目录）或 `DSH_DESKTOP_BRAND_ARCHIVE_BASE64`，白名单 6 路径，构建结束自动还原上游文件；用法见 `apps/desktop/README.md` `### Brand injection`。欢迎页条目须命名 `renderer/assets/welcome-brand.svg`（内嵌 PNG 的 SVG 即可），旧备份 zip 里的 `.png` 命名会被拒绝并提示；`brand-favicon-64.png` 存在时经 extraResources 进包（main.ts `windowIconPath` 消费） |

## 9. 远端与本地现状（截至 2026-09-24）

- fork `sjjiitt/deepseek-harness` 的 `master` = 上游 `dsh-v0.1.7-rc.1` + 5 个提交：Windows 打包可靠性 / VM 宿主稳定性 / Linux 便携通道 / 体积与速度 / Linux 编辑菜单本地化。
- 远端已清理：Releases **0**、桌面类 artifacts **0**、桌面类 workflow run 全删；非上游 tag 已删（保留 22 个上游 `dsh-v*`）。
- 上游网络里的旧美术提交已从分支历史移除且不可达（悬空对象由 GitHub GC 回收）。
- 本地 `backup/pre-brand-removal` 分支保留含旧美术的旧历史：**不要 push**。
- 本机已交付物（均在未纳入版本控制的 `apps/desktop/.desktop-build/` 下）：
  - `win-delivery/`：Windows 未签名安装包 282.4 MB 与 `.blockmap`
  - `update-work-*/`：Linux 覆盖更新包约 246 KB
  - `branding-backup/`：我方品牌美术备份（`branding-assets.zip` 308 KB + 6 个文件）
- 未完成项：~~构建时品牌注入机制~~（2026-09-24 已实现，见第 8 节）；~~`compression=maximum` 旋钮~~（已撤：config 拒收，Windows workflow 选项同步移除）；~~`prepare:dsh` 准备态 Office 冒烟与打包后重复~~（已改：portable 打包链传 `--defer-runtime-smoke`，Office 冒烟只在打包后跑一次，省 ~65 s）。

## 10. 接手清单（第一步做什么）

1. 用 `ci-run.ps1` 跑一次 `desktop-linux-arm64.yml`，确认通道健康并记录各阶段耗时。
2. 在麒麟机上解压产物，跑 `./run-deepseek-harness.sh` 与 `./install-desktop-entry.sh`，确认窗口、菜单语言、Office 预览、连接状态。
3. 需要改"关于/菜单文案"时：优先改 `apps/desktop/src/locale.ts`（唯一文案来源），只重建壳，用覆盖更新包替换 `resources/app/lib/main.js`。
4. 需要品牌图标时：构建前设 `DSH_DESKTOP_BRAND_ARCHIVE=<zip 或目录>`（CI 密钥场景用 `_BASE64` 变体）；欢迎页条目命名 `renderer/assets/welcome-brand.svg`（内嵌 PNG 的 SVG 即可，`.png` 会被拒）。不要把我方美术提交进仓库。
5. 任何改动遵循根 `AGENTS.md` 与 `docs/testing.md`；本地只跑受影响的最小检查（见 `.agents/skills/dsh-pre-push-checks`）。
