<div align="center">

# candy-term · 糖果终端

**基于 Rust + Tauri v2 构建的高性能现代 SSH & SFTP 桌面工作台**

[简体中文](./README.md) | [English](./README.en.md)

[![License: MIT](https://img.shields.io/badge/License-MIT-pink.svg)](./LICENSE)
[![Rust](https://img.shields.io/badge/Rust-Tauri%20v2-orange.svg)](https://v2.tauri.app/)
[![Vue](https://img.shields.io/badge/Vue-3%20%2B%20TypeScript-42b883.svg)](https://vuejs.org/)

</div>

---

## ✨ 核心特性

- **极速异步 SSH 内核**：基于纯 Rust 异步栈 `russh` + `Tokio` 驱动，支持多标签终端并行会话、PTY 自适应缩放（`ResizeObserver` + `@xterm/addon-fit`）、终端内容搜索（`Ctrl/Cmd + F`）与断线快速重连。
- **全面认证支持**：
  - 密码认证（Password）
  - 私钥认证（支持本地密钥文件选择或直接粘贴 PEM / OpenSSH 私钥，含 Passphrase 解密及 RSA SHA-256/512 自动协商）
  - 本地 SSH Agent（`SSH_AUTH_SOCK`）
  - 键盘交互式认证（Keyboard-Interactive）
  - 主机公钥指纹校验（SHA-256 `known_hosts` 持久化与交互式信任弹窗）
- **SFTP 可视化文件浏览器**：基于 `russh-sftp` 的独立子系统通道，支持目录导航、隐藏文件切换、本地文件上传（选择器与拖拽上传）、文件下载、新建目录、重命名、删除以及实时传输进度条。
- **代理与端口转发**：
  - 连接代理：支持 **SOCKS5 代理**、**HTTP CONNECT 代理** 与 **SSH 跳板机（ProxyJump）**。
  - 端口转发：支持 **本地转发（`-L`）**、**远程转发（`-R`）** 与 **动态 SOCKS5 代理（`-D`）**，支持配置连接时自启动及运行中启停。
- **运维效率工具**：
  - **快捷命令片段（Snippets）**：内置常用运维指令，支持发送到当前终端或一键广播到全部已连接会话。
  - **节点实时监控**：通过独立 `exec` 通道采集远程服务器主机名、OS/内核、运行时长、Load Average、CPU、内存与根分区磁盘使用率（支持 5 秒自动刷新）。
- **简约糖果桌面体验**：
  - 基于 **Vue 3 + TypeScript + Pinia + Tailwind CSS v4 + shadcn-vue**（`reka-ui` + `lucide-vue-next`）构建。
  - 支持 **日间模式 / 夜间模式 / 跟随系统** 实时切换（xTerm 终端主题同步适配）。
  - 支持 **简体中文 / English** 双语 i18n，默认自动跟随操作系统/浏览器语言。
  - 响应式三栏布局，适配桌面端宽屏与窄屏窗口。

---

## 🧱 技术栈

| 层级 | 技术选型 |
| :--- | :--- |
| 桌面容器 | Tauri v2 (`tauri`, `tauri-plugin-dialog`) |
| 后端内核 | Rust, Tokio, `russh` 0.65, `russh-sftp` 4.0, `serde`, `thiserror` |
| 前端框架 | Vue 3 (`<script setup>`), TypeScript, Pinia |
| UI 与样式 | Tailwind CSS v4, shadcn-vue (`reka-ui`, `class-variance-authority`, `clsx`, `tailwind-merge`), `lucide-vue-next` |
| 终端引擎 | `@xterm/xterm`, `@xterm/addon-fit`, `@xterm/addon-web-links`, `@xterm/addon-search` |
| 国际化与测试 | `vue-i18n`, Vitest (`@vue/test-utils`, `happy-dom`), `cargo test` |
| 包管理器 | `pnpm` |

---

## 📁 项目结构

```text
candy-term/
├── LICENSE                      # MIT 开源协议
├── README.md                    # 中文文档
├── README.en.md                 # 英文文档
├── package.json                 # 前端依赖与脚本
├── src/
│   ├── App.vue                  # 主工作台布局（顶栏/主机栏/终端区/工具抽屉）
│   ├── style.css                # Tailwind v4 与 shadcn-vue 日夜主题变量
│   ├── i18n/                    # 中英文国际化配置与自动语言识别
│   ├── stores/                  # Pinia 状态管理 (hosts/sessions/settings/snippets)
│   ├── components/
│   │   ├── ui/                  # shadcn-vue 基础组件库
│   │   ├── hosts/               # 主机侧边栏与连接编辑弹窗
│   │   ├── terminal/            # xterm.js 终端视图与主机指纹确认弹窗
│   │   ├── sftp/                # SFTP 文件浏览与上传下载面板
│   │   └── tools/               # 端口转发、快捷命令、节点监控与偏好设置
│   └── tests/                   # 前端 Vitest 单元测试与组件测试
└── src-tauri/
    ├── Cargo.toml               # Rust 依赖配置
    ├── tauri.conf.json          # Tauri 应用配置
    └── src/
        ├── lib.rs / main.rs     # Tauri 应用启动与命令注册
        ├── commands.rs          # Tauri IPC 命令入口
        ├── models.rs / error.rs # 数据模型与统一错误定义
        ├── storage.rs           # 本地 JSON 原子持久化（hosts/snippets/known_hosts）
        └── ssh/                 # SSH 客户端、SFTP、代理、端口转发与监控采集
```

---

## 🚀 本地开发与构建

### 环境依赖
- **Rust** >= 1.90 (`rustc`, `cargo`)
- **Node.js** >= 20 & **pnpm** >= 10

### 常用命令

```bash
# 1. 安装前端依赖
pnpm install

# 2. 启动 Tauri 桌面端开发模式（热更新前端 + Rust 后端）
pnpm tauri dev

# 3. 仅启动纯前端预览模式
pnpm dev

# 4. 构建生产安装包
pnpm tauri build
```

---

## 🧪 单元测试

项目前后端核心模块均包含完整单元测试：

```bash
# 前端类型检查与生产构建
pnpm build

# 运行前端单元测试（Vitest：i18n、Pinia stores、工具函数、Vue 组件）
pnpm test

# 运行 Rust 后端单元测试（存储持久化、SOCKS5/HTTP 代理握手、SFTP 路径/权限、监控解析）
cargo test --manifest-path src-tauri/Cargo.toml
```

---

## 📄 开源协议

本项目基于 [MIT License](./LICENSE) 开源。
