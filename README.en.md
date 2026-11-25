<div align="center">

# candy-term

**A high-performance modern SSH & SFTP desktop workspace built with Rust and Tauri v2**

[简体中文](./README.md) | [English](./README.en.md)

[![License: MIT](https://img.shields.io/badge/License-MIT-pink.svg)](./LICENSE)
[![Rust](https://img.shields.io/badge/Rust-Tauri%20v2-orange.svg)](https://v2.tauri.app/)
[![Vue](https://img.shields.io/badge/Vue-3%20%2B%20TypeScript-42b883.svg)](https://vuejs.org/)

</div>

---

## ✨ Key Features

- **High-Performance Async SSH Engine**: Powered by pure Rust `russh` + `Tokio`, supporting multi-tab terminal sessions, responsive PTY resizing (`ResizeObserver` + `@xterm/addon-fit`), in-terminal search (`Ctrl/Cmd + F`), and quick reconnect.
- **Comprehensive Authentication**:
  - Password authentication
  - Private Key authentication (file picker or inline PEM/OpenSSH paste, optional passphrase decryption, automatic RSA SHA-256/512 negotiation)
  - Local SSH Agent (`SSH_AUTH_SOCK`)
  - Keyboard-Interactive authentication
  - Interactive SHA-256 host key fingerprint verification persisted in `known_hosts.json`
- **Visual SFTP File Browser**: Dedicated `russh-sftp` subsystem channel supporting directory browsing, hidden file toggle, file upload (picker & drag-and-drop), download, folder creation, rename, delete, and real-time progress indicator.
- **Proxies & Port Forwarding**:
  - Connection proxies: **SOCKS5**, **HTTP CONNECT**, and **SSH Jump Host (ProxyJump)**.
  - Port forwarding tunnels: **Local (`-L`)**, **Remote (`-R`)**, and **Dynamic SOCKS5 (`-D`)** with auto-start and live toggle controls.
- **Productivity Tools**:
  - **Command Snippets**: Built-in and custom command library with single-terminal execution or multi-session broadcast.
  - **Server Telemetry**: Lightweight `exec` probe displaying hostname, OS/kernel, uptime, load average, CPU, memory, and root disk usage (with optional 5s auto-refresh).
- **Minimal Candy UI**:
  - Built with **Vue 3 + TypeScript + Pinia + Tailwind CSS v4 + shadcn-vue** (`reka-ui` + `lucide-vue-next`).
  - Live **Light / Dark / System** theme switching with synchronized xterm.js color palettes.
  - Bilingual **English / 简体中文** i18n defaulting to the system language.
  - Responsive layout tailored for wide desktop displays and compact windows.

---

## 🧱 Tech Stack

| Layer | Technologies |
| :--- | :--- |
| Desktop Shell | Tauri v2 (`tauri`, `tauri-plugin-dialog`) |
| Backend Core | Rust, Tokio, `russh` 0.65, `russh-sftp` 4.0, `serde`, `thiserror` |
| Frontend | Vue 3 (`<script setup>`), TypeScript, Pinia |
| UI & Styling | Tailwind CSS v4, shadcn-vue (`reka-ui`, `class-variance-authority`, `clsx`, `tailwind-merge`), `lucide-vue-next` |
| Terminal | `@xterm/xterm`, `@xterm/addon-fit`, `@xterm/addon-web-links`, `@xterm/addon-search` |
| i18n & Testing | `vue-i18n`, Vitest (`@vue/test-utils`, `happy-dom`), `cargo test` |
| Package Manager | `pnpm` |

---

## 🚀 Development & Build

### Prerequisites
- **Rust** >= 1.90 (`rustc`, `cargo`)
- **Node.js** >= 20 & **pnpm** >= 10

### Commands

```bash
# 1. Install frontend dependencies
pnpm install

# 2. Launch Tauri desktop app in development mode
pnpm tauri dev

# 3. Preview frontend only in browser
pnpm dev

# 4. Build production desktop bundle
pnpm tauri build
```

---

## 🧪 Unit Tests

Both frontend and backend core modules have comprehensive unit tests:

```bash
# Typecheck and production frontend bundle
pnpm build

# Run frontend unit and component tests (Vitest)
pnpm test

# Run Rust backend unit tests
cargo test --manifest-path src-tauri/Cargo.toml
```

---

## 📄 License

Licensed under the [MIT License](./LICENSE).
