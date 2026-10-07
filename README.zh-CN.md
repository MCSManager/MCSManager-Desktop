# MCSManager Desktop

[English](README.md) | [简体中文](README.zh-CN.md)

一个用于在本地运行 [MCSManager](https://github.com/MCSManager/MCSManager) 的 Windows 桌面外壳。
它将你的 MCSManager 守护进程（daemon）和面板（panel）作为子进程启动与停止，实时推送它们的
控制台输出，并在标签页窗口中嵌入面板网页界面。基于 Tauri v2（Rust）与 React 19 + TypeScript 构建。

## 环境要求

- Node.js 22 或更高版本（用于安装、开发以及运行被托管的服务）
- Rust 工具链（用于 `cargo` / Tauri 构建；参见 [Tauri 前置条件](https://tauri.app/start/prerequisites/)）
- 一份**已构建**的 MCSManager 部署，放置在应用旁的固定服务文件夹中：
  `daemon/` 和 `web/`（各自包含 `app.js`，由 MCSManager 发行包或 `build.bat` 生成）

## 服务目录结构

服务目录相对于**运行目录**固定 —— 即包含 `mcsmanager-desktop.exe` 的文件夹
（开发环境中即项目根目录）：

```
<run directory>/
├── mcsmanager-desktop.exe
├── daemon/        # daemon 部署（在此运行 node app.js）
└── web/           # panel 部署（在此运行 node app.js）
```

这是一种便携式布局：请将 exe 与两个服务文件夹放在一起。两个文件夹会在启动时校验；
缺失的文件夹会在「设置」中以警告形式呈现。

## 配置

在应用内打开「设置」，或直接编辑 `config.json`。该文件位于应用数据目录：

```
%APPDATA%/com.yumao.mcsmanager-desktop/config.json
```

首次启动时会以默认值创建；若文件损坏，会备份为 `config.json.bak` 并替换为默认值。

每个服务（`daemon` 和 `panel`）的配置项包括：

- `script` —— 在其固定文件夹内运行的入口文件（发行版为 `app.js`，
  开发检出部署为 `production/app.js`）
- `extraArgs`、`startDelayMs`（启动面板前等待的毫秒数）、`readyPort`
  （用于探测就绪状态的 TCP 端口）、`enabled`

全局字段：`nodePath`（Node.js 可执行文件）、`panelUrl`（在面板标签页中打开的 URL）、
`stopTimeoutMs`、`maxLogLines`、`language`。

## 运行

```
npm install
npm run tauri dev     # 以热重载方式开发
npm run tauri build   # 生成打包安装程序
```

完整的 Windows 构建与发布指南：[`.agents/skills/building-windows-exe/SKILL.md`](.agents/skills/building-windows-exe/SKILL.md)。

## 测试

```
npm test              # 前端单元 + 集成测试（vitest）
npm run test:rust     # 后端测试（cargo）
npm run typecheck     # tsc --noEmit
npm run lint          # eslint
npm run format:check  # prettier
```

## 鸣谢

感谢 Mimir (https://github.com/parkes-mimir/) 为本项目提供 Token 支持，极大的加速了我们构建 MCSManager 生态的速度。
