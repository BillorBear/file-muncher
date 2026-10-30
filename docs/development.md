# 本地开发规范与流程

日常开发直接从源码启动 Electron，不需要生成安装包。安装包用于发布或验证安装行为，开发、测试、提交与发布分别进行。

## 环境与项目结构

- 使用 Node.js 24 和 npm；GitHub Actions 也使用 Node.js 24。
- 在仓库根目录运行 `npm ci`，按 `package-lock.json` 安装项目依赖。不要改用其他包管理器或全局安装 Electron。
- 渲染层回归脚本使用本机 Google Chrome（Playwright 的 `channel: 'chrome'`）；仅安装 Playwright Chromium 不满足该条件。
- 桌面调试需要图形桌面环境。产品目标是 macOS 和 Windows；Linux 可运行兼容的工具命令和浏览器预览，不代表已支持 Linux 桌面安装。

| 目录 / 文件 | 职责 |
| --- | --- |
| `src/main/` | Electron 窗口、文件处理、IPC 权限、状态持久化 |
| `src/main/preload.ts` | 渲染层与主进程之间的受限接口 |
| `src/renderer/` | 主界面、悬浮宠物、设置面板、五款动画与交互 |
| `src/shared/` | 类型、成长规则、宠物尺寸和朝向计算 |
| `tests/` | 文件安全、持久化、窗口策略与纯逻辑测试 |
| `scripts/` | 构建、预览、浏览器回归和桌面验收脚本 |
| `assets/` | 产品图标等随源码维护的资源 |
| `docs/` | 产品设计、开发调试、参考来源及验证边界 |
| `.github/workflows/build.yml` | 手动或版本标签触发的安装包构建 |
| `dist/`、`release/`、`test-results/` | 构建、打包和测试产物，不提交 |

## 一次改动的标准流程

1. 阅读仓库 `AGENTS.md` 和相关代码，先运行 `git status --short`，确认已有改动。共享工作区中的未提交内容属于用户的待审阅状态，不要覆盖或还原无关改动。
2. 明确本次行为变化和受影响范围。沿用 TypeScript、现有模块与依赖；不因小改动引入框架、包管理器或无关重构。
3. 按[本地调试与启动](local-debugging.md)使用独立开发配置启动，复现问题。纯样式或动画可以先用浏览器预览。
4. 修改最小必要代码。文件操作保持在主进程；保留路径保护、一次性批次、窗口权限及永久删除确认。注释使用英文，复杂接口保持显式类型。
5. 按下表验证。文件处理或状态逻辑变化优先补充行为测试；不要为无行为变化的文案、格式修改增加同构测试。
6. 检查 `git --no-pager diff` 和 `git diff --check`，确认没有临时数据、凭证或无关文件，再提交本次范围。

### 按改动范围选择验证

| 改动范围 | 验证方式 |
| --- | --- |
| TypeScript 或应用行为变化 | `npm run check`：类型检查、单元/行为测试、构建 |
| 页面、动画、拖动状态、气泡、大小设置 | 再运行 `npm run test:renderer`；必要时人工观察动画和布局 |
| 主进程、preload、窗口、原生光标、文件处理或持久化 | 再运行 `npm run test:desktop` |
| 文档改动 | 核对命令与源码、相对链接和 Markdown；`git diff --check` |
| 安装器、图标、平台构建配置 | 只构建受影响的平台，并验证对应安装包 |

`npm run check` 不生成安装包，也不包含浏览器或完整桌面回归。测试通过后没有新改动、失败或未解决疑点时，不需要重复运行同一批检查。

浏览器回归使用模拟的桌面 API，不操作真实文件。桌面回归会执行真实回收站操作和永久删除，但仅使用脚本自己创建的临时文件与独立配置；系统回收站可能留下测试样本。不要把自动化拖放当成人工 Finder / Explorer 拖放手感验收。Windows 与 Intel Mac 的实机边界见[验收记录](validation.md)。

## 本地提交

只暂存明确属于当前任务的文件，检查暂存差异后提交：

```sh
git status --short
git add README.md docs/development.md docs/local-debugging.md
git --no-pager diff --cached
git diff --cached --check
git commit -m "docs: document local development and debugging"
```

上面的路径与提交信息只是文档改动示例，实际按本次改动替换。应用代码、测试、必要资源和 `package-lock.json` 应进入版本控制；不要提交 `node_modules/`、`dist/`、`release/`、`test-results/`、`.local-data/`、日志、用户文件、环境私密配置、证书或密钥。

本地提交与上传 GitHub 是两个动作。创建远程仓库之前不执行 push；后续取得真实仓库地址，再确认 `git remote -v`、配置远端并明确推送分支。不要在文档或脚本中写入访问令牌。

## 发布时再打包

日常启动使用 `npm start`，调试说明见[启动流程](local-debugging.md)。仅在需要分发或验收安装包时选择构建目标：

| 发布目标 | 命令 |
| --- | --- |
| Mac Apple Silicon 与 Intel | `npm run pack:mac` |
| Windows x64 | `npm run pack:win` |
| 仅 Mac Apple Silicon | `npm run build` 后执行 `npx --no-install electron-builder --mac dmg --arm64` |
| 仅 Mac Intel | `npm run build` 后执行 `npx --no-install electron-builder --mac dmg --x64` |

这些命令默认输出到 `release/`。macOS 包应在 macOS 上生成；Windows 包可交叉构建，但发布验收应在 Windows 上安装、拖放和恢复回收站样本。构建成功不等于目标系统验收通过。

现有 GitHub Actions 只由手动操作或 `v*` 标签触发，普通分支提交不会触发安装包构建。工作流上传构建产物，不自动创建 GitHub Release。当前 Mac 采用 ad-hoc 签名、未公证，Windows 未作发布者签名；正式分发前需补齐相应证书流程。
