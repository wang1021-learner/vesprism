//! 统一工作台（Agent / Flow / `.vesp`）。
//!
//! 与聊天编程区是两个产品：本模块不读写 `compositions/`，也不走
//! `apply_composition`。聊天区继续用 grok-session 组装单。

pub mod agents;
pub mod bindings;
pub mod flows;
pub mod mcp_server;
