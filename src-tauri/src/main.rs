// 桌面端二进制入口，调用库模块中的 run() 启动 Tauri 应用
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

fn main() {
    candy_term_lib::run();
}
