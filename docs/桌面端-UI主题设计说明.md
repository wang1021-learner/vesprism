# 桌面端 UI 主题设计说明

> 更新日期：2026-07-26  
> **配色参考：Pi Web UI**（`@earendil-works/pi-web-ui` + mini-lit Claude-like light theme）  
> 实现：`crates/jike-grok-desktop/src/App.css`

---

## 1. 参考来源

| 来源 | 取什么 |
|------|--------|
| `pi-web-ui` `app.css` | `.user-message-container` 暖橙渐变气泡 |
| mini-lit theme tokens（打进 dist 的 CSS 变量） | 白底、灰 muted、近黑 primary、浅灰 border |
| 主产品姿态 | **白为主**，橙色做用户气泡/焦点，主按钮用深灰黑 |

不抄整站布局，只对齐 **色板与用户消息气质**。

---

## 2. 色板（`:root`）

| Token | 值 | 对应 Pi |
|-------|-----|---------|
| `--bg-canvas` | `#f5f5f5` | muted 灰壳 |
| `--surface-elevated` | `#ffffff` | `--background` / `--card` 白 |
| `--surface-muted` | `#f7f7f7` | `--muted` ~ oklch(97%) |
| `--text-primary` | `#1c1c1c` | `--foreground` ~ oklch(14.5%) |
| `--text-secondary` | `#6b6b6b` | `--muted-foreground` |
| `--border-solid` | `#ebebeb` | `--border` ~ oklch(92.2%) |
| `--cta` | `#2a2a2a` | light `--primary` 深色按钮 |
| `--accent` | `#ff6b00` | 用户气泡橙 |
| `--user-bubble-*` | 橙/琥珀半透明 | `linear-gradient(135deg, #d94f00…, #ff6b00…, #d4a500…)` |

---

## 3. 组件落点

- **用户气泡**：Pi 式暖橙半透明渐变 + 橙边（非纯灰气泡）  
- **New chat / 发送 / 允许权限**：深灰黑实心（Pi primary）  
- **输入框 focus**：淡橙 ring  
- **侧栏选中**：浅灰底 + 左侧橙条  

---

## 4. 预览

```bash
cd crates/jike-grok-desktop
cargo tauri dev
```
