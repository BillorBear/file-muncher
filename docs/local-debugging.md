# 本地调试与启动

推荐循环：**编辑源码 → 正常退出开发实例 → `npm start` → 验证交互**。`npm start` 只执行一次构建，再启动 Electron；当前没有自动 watch、热更新或改动后自动重启。

## 1. 安装依赖

进入仓库根目录，确认 Node.js 24 与 npm 可用，然后安装锁定版本的依赖：

```sh
node --version
npm --version
npm ci
```

Electron 首次安装会下载运行时。如果网络导致该步骤失败，先检查安装日志和网络；仅在需要时选择可信镜像重试下载。例如 npm mirror：

macOS / Linux shell：

```sh
ELECTRON_MIRROR=https://npmmirror.com/mirrors/electron/ node node_modules/electron/install.js
```

Windows PowerShell：

```powershell
$env:ELECTRON_MIRROR = 'https://npmmirror.com/mirrors/electron/'
node node_modules/electron/install.js
Remove-Item Env:ELECTRON_MIRROR
```

依赖安装成功后不必在每次启动前重装。不要关闭下载校验或禁用 Electron 沙箱来绕过问题。

## 2. 使用独立配置启动桌面版

开发配置放在仓库的 `.local-data/development/`，该目录不进入版本控制。`FILE_MUNCHER_USER_DATA` 必须是绝对路径，以下命令从当前仓库生成该路径。

macOS / Linux shell：

```sh
mkdir -p .local-data/development
export FILE_MUNCHER_USER_DATA="$(pwd -P)/.local-data/development"
npm start
```

Windows PowerShell：

```powershell
New-Item -ItemType Directory -Force -Path .local-data/development | Out-Null
$env:FILE_MUNCHER_USER_DATA = (Resolve-Path .local-data/development).Path
npm start
```

Linux shell 示例描述命令语法；当前产品桌面目标为 macOS 和 Windows，未承诺 Linux 原生桌面支持。

上述变量只在当前终端及其子进程中生效。使用另一终端时要重新设置。若不设置变量，应用会沿用系统应用数据目录下的 `文件粉碎机`，可能读写日常使用的偏好和成长记录。设置隔离配置**不会隔离真实文件删除**：源码版仍能将用户拖入的文件移到回收站，或按确认执行永久删除。

关闭主窗口只会让宠物留在桌面，进程并未退出。修改代码后，先从应用托盘菜单或宠物右键面板选择“退出 file muncher”；macOS 也可在应用激活时按 `Cmd+Q`。等待终端返回，再运行 `npm start`。同一配置目录只允许一个实例，未退出就重启可能只是唤起旧窗口。

应用正常退出会等待进行中的删除与设置写入；不要在文件处理中强杀进程或反复终止终端。需要保留状态复现时继续使用同一开发配置；需要全新状态时使用另一个绝对路径，不要手动改写正在运行的 `state.json`。

## 3. 准备可丢弃的拖放样本

真实投喂样本应创建在**仓库外**的系统临时目录。开发版会保护整个应用源码目录，因此仓库内的 `.local-data/fixtures/` 也不能用于真实投喂；不要为测试绕过路径保护。

macOS / Linux shell：

```sh
fixture_dir="$(mktemp -d "${TMPDIR:-/tmp}/file-muncher-fixtures.XXXXXX")"
printf 'File Muncher disposable fixture.\n' > "$fixture_dir/snack.txt"
printf '%s\n' "$fixture_dir"
```

Windows PowerShell：

```powershell
$fixtureDir = Join-Path ([System.IO.Path]::GetTempPath()) ('file-muncher-fixtures-' + [guid]::NewGuid().ToString('N'))
New-Item -ItemType Directory -Path $fixtureDir | Out-Null
Set-Content -Path (Join-Path $fixtureDir 'snack.txt') -Value 'File Muncher disposable fixture.'
Write-Output $fixtureDir
```

在 Finder / Explorer 打开输出的目录，将 `snack.txt` 拖给宠物；优先验证默认回收站模式及回收站恢复。需要重复投喂时重新生成样本。永久删除只用确认可丢弃的样本；普通永久删除不等于安全擦除。

## 4. 浏览器外观预览

```sh
npm run preview
```

打开 [主窗口预览](http://127.0.0.1:4173/)、[宠物预览](http://127.0.0.1:4173/?view=pet) 或[大小面板预览](http://127.0.0.1:4173/?view=pet-settings)。预览只监听 `127.0.0.1:4173`，可用浏览器开发者工具检查 CSS、DOM 和动画。

预览不支持真实删除、系统文件选择、原生窗口移动或跨窗口状态同步，预览设置不写入桌面配置。修改源码后，在另一终端执行 `npm run build`，然后手动刷新页面；也可停止预览服务后重新执行 `npm run preview`。停止该 HTTP 服务可使用 `Ctrl+C`。

## 5. 主进程与渲染进程断点调试

先正常退出上一开发实例。保持第 2 步的 `FILE_MUNCHER_USER_DATA` 环境变量，手动构建后使用项目内 Electron 启动调试，不需要打包：

macOS / Linux shell：

```sh
npm run build && npx --no-install electron \
  --inspect=127.0.0.1:9229 \
  --remote-debugging-address=127.0.0.1 \
  --remote-debugging-port=9222 \
  .
```

Windows PowerShell：

```powershell
npm run build
if ($LASTEXITCODE -ne 0) { throw 'Build failed.' }
npx --no-install electron --inspect=127.0.0.1:9229 --remote-debugging-address=127.0.0.1 --remote-debugging-port=9222 .
```

`9229` 是主进程 Node inspector；`9222` 是 Chromium 渲染进程调试入口。两者仅绑定本机 `127.0.0.1`，不要改为 `0.0.0.0` 或转发到公网。

1. 在 Google Chrome 打开 `chrome://inspect/#devices`。
2. 勾选 **Discover network targets**，点击 **Configure**，添加 `127.0.0.1:9229` 与 `127.0.0.1:9222`。
3. 主进程选择 Node / Electron 对应目标的 **inspect**，调试 `src/main/` 的文件处理、窗口与 IPC。
4. 渲染进程按 URL 选择 `?view=main`、`?view=pet` 或 `?view=pet-settings` 对应目标。大小面板只有打开后才出现。使用 **Elements** 检查布局，**Console** 查看异常，**Sources** 设置断点。

构建已为主进程和渲染进程生成 source map。若要在启动第一行暂停，把 `--inspect=127.0.0.1:9229` 替换为 `--inspect-brk=127.0.0.1:9229`；连接主进程调试器并恢复执行后才会出现应用窗口。调试结束通过应用的正常退出入口关闭进程。

如果端口已被占用，改用其他本机端口，并同步修改 Chrome 的目标配置。调试目标未出现时，检查终端报错、构建是否成功，以及当前进程是否因已有同配置实例而退出。不要为了调试关闭上下文隔离或启用渲染进程 Node 集成。

参数参考：[Electron 主进程调试](https://www.electronjs.org/docs/latest/tutorial/debugging-main-process)、[Electron 命令行开关](https://www.electronjs.org/docs/latest/api/command-line-switches)。

## 6. 验证与常见边界

```sh
npm run check
npm run test:renderer
npm run test:desktop
```

按[开发规范](development.md)选择相关检查，不必每次全部运行。浏览器测试需要本机安装 Google Chrome；桌面测试需要图形桌面，脚本会自行创建独立临时配置与样本，不使用上面开发实例的成长记录。

- **界面仍是旧版**：确认真正退出了后台宠物，再启动；当前没有自动 watch。
- **预览不能删文件**：浏览器预览按设计只展示外观，真实投喂请使用 Electron 开发版。
- **样本被保护目录拦截**：确认样本位于仓库和应用数据目录之外的临时目录。
- **自动化通过但拖动手感不对**：原生 Finder / Explorer 拖放、跨屏移动和窗口手感仍需人工检查。文件进入应用或宠物窗口、产生包含 `Files` 的 DOM 拖拽事件后才会追视，普通鼠标移动和窗口外拖动不会触发；自动化事件不等于人工系统拖放。
- **Mac 构建成功**：不代表 Windows 安装、Explorer 拖放或 Intel Mac 运行通过。实际平台验证情况见[验收记录](validation.md)。

安装包构建仅在准备发布或验证安装器时执行，命令见[发布流程](development.md#发布时再打包)。
