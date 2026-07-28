# Claude Design 能力对照与 Grok 桌面 Artifact 路线图

> **状态：部分 superseded（2026-07-28）**  
> 产品方向已确认为 **独立 Design 模式**（侧栏一级入口，与对话平级）。  
> **完整方案正本：** [`独立Design产品完整方案.md`](./独立Design产品完整方案.md)  
> 本文保留作早期「聊天内 Artifact」能力对照；新开发以正本为准。

---

# （历史）Claude Design 能力对照与 Grok 桌面 Artifact 路线图

> 整理日期：2026-07-28  
> 对照对象：Anthropic **Claude Design**（Anthropic Labs，2026-04）  
> 我方现状：`crates/jike-grok-desktop` 右侧 **ArtifactPanel**（HTML/SVG 预览）  
> ~~定位原则：不是再做一个 Figma，而是 coding agent 内的可预览交付物闭环~~ → 已改为独立 Design 产品，见正本。

---

## 1. 产品定位差异

| 维度 | Claude Design | 我们（Grok 桌面 Artifact） |
|------|---------------|---------------------------|
| 主场景 | 独立设计产品：原型 / 幻灯片 / one-pager | 对话写代码时顺带产出可预览 UI / 原型 |
| 引擎 | 专用视觉模型 + Design 交互 | 复用 Grok Build agent（工具读写工作区） |
| 与代码关系 | 事后 handoff 到 Claude Code | **同一会话、同一工作区**，编辑工具即实现 |
| 画布形态 | 左聊右画布，偏设计工具 | 左聊右预览，偏「Artifacts + 仓库」 |
| 成功标准 | 视觉成品可导出、可协作 | 预览可信 + 可回到仓库继续迭代 |

**差异化一句话**：Claude Design 从「设计」走向「代码」；我们从「代码」长出「设计预览」。

---

## 2. 能力对照表

图例：✅ 已有 · 🔶 部分 · ⬜ 未做 · ⛔ 明确不做（或远期再说）

| Claude Design 能力 | 我方现状 | 目标阶段 | 备注 |
|--------------------|----------|----------|------|
| 左对话 + 右画布 | ✅ | — | `ArtifactPanel` + 聊天主区 |
| HTML 交互预览 | ✅ | — | iframe `srcDoc` + `sandbox` |
| SVG 预览 | ✅ | — | |
| 消息内「预览」按钮 | ✅ | — | `AssistantMarkdown` 对 `html`/`svg` 代码块 |
| 工具编辑完成后预览文件 | ✅ | MVP 强化 | `ToolCallCard` 读工作区文件 |
| 预览 / 源码切换 | ✅ | — | |
| 下载到本地 | ✅ | — | 系统另存为 |
| **多版本历史**（同会话迭代） | ⬜ → MVP | MVP | 打开新产物时压入版本栈，可回看 |
| **来源跟踪**（代码块 / 文件路径） | ⬜ → MVP | MVP | 文件源可刷新 |
| **画布可调宽** | ⬜ → MVP | MVP | 拖拽分栏 |
| **设备宽度框**（桌面/平板/手机） | ⬜ → MVP | MVP | 仅预览框宽度，非真机 |
| 编辑完成后自动打开预览 | ⬜ → MVP | MVP | 默认开；可关 |
| 流式生成中实时预览 | ⬜ | P1 | 需在未闭合 fence 时增量解析，注意性能 |
| 附件/截图输入 | ⬜ | P1 | 大纲已列；设计稿对齐强依赖 |
| 从仓库抽 design tokens | ⬜ | P1 | CSS 变量 / Tailwind / 组件库扫描 |
| 品牌指南文档导入 | ⬜ | P2 | md/pdf 风格说明 |
| 画布内点选元素批注 | ⬜ | P2 | postMessage + 元素路径回灌 prompt |
| 幻灯片专用模式 | ⬜ | P2 | 可复用 HTML 页，或 PPTX skill |
| PDF / PPTX 导出 | ⬜ | P2 | 桌面可接现有 skill 思路或本机转换 |
| Canva 等外部 handoff | ⛔ | — | 非核心；优先本地与仓库 |
| 组织级协作/权限共享 | ⛔ | — | 当前个人/小团队自用 |
| 独立 Design 产品壳 | ⛔ | — | 不做第二应用，嵌在 agent 内 |

---

## 3. 当前架构（实现基线）

```
用户消息 / Agent 工具
        │
        ├─ assistant markdown 中 ```html / ```svg
        │     └─ AssistantMarkdown「预览」→ openArtifact(lang, code)
        │
        └─ tool_call edit 完成且路径为 *.html / *.svg
              └─ ToolCallCard → read_file_for_preview → openArtifact

ArtifactContext（内存状态）
        └─ ArtifactPanel
              ├─ iframe 预览（sandbox allow-scripts）
              ├─ 源码 tab
              └─ save_artifact_file 下载
```

**约束（保持）**

1. 只加不改官方 `xai-grok-shell` 行为；预览全在桌面壳。  
2. 读文件必须走 `read_file_for_preview` 工作区边界校验。  
3. iframe 保持 sandbox，避免预览页碰主应用 DOM。  
4. 不把密钥或任意盘路径暴露进预览。

---

## 4. 分阶段路线

### MVP（本迭代：让「对话 → 预览」像设计工具）

目标：同一轮改 UI 时，预览面板**可迭代、可对照、可适配宽度**。

| # | 项 | 验收 |
|---|----|------|
| M1 | 版本历史 | 多次打开预览形成列表；可切换旧版 |
| M2 | 来源 + 刷新 | 文件来源显示路径；按钮重新读盘 |
| M3 | 分栏拖拽 | 面板宽度可拖，范围约 360–720px，会话内记住 |
| M4 | 设备宽度 | Fluid / Desktop / Tablet / Mobile 四档 |
| M5 | 自动打开 | 完成 `edit` 且为 html/svg 时自动预览（可关） |

### P1（下一阶段：输入与一致性）

| # | 项 | 说明 |
|---|----|------|
| P1-1 | 图片/截图进 Composer | 贴设计稿、报 bug 截图 |
| P1-2 | 流式 HTML 预览（可选） | 生成结束自动开；长流式再考虑节流刷新 |
| P1-3 | Design token 提示 | 扫描工作区 CSS 变量，注入 system 或 skill 片段 |
| P1-4 | 多 artifact 标签 | 同时挂两个页面对比（登录 vs 设置） |
| P1-5 | 写入工作区快捷操作 | 「保存到当前项目路径」而不只是另存为 |

### P2（再往后：更像 Design 产品）

| # | 项 | 说明 |
|---|----|------|
| P2-1 | 元素点选 → 回灌对话 | 「把这个按钮改成主色」 |
| P2-2 | 幻灯片 / one-pager 模板 skill | 约定 HTML 结构 + 导出 PDF |
| P2-3 | PPTX/PDF 导出 | 复用或包装现有文档 skill |
| P2-4 | 主题/品牌包 | 项目级 `.grok/design.json` |

---

## 5. MVP 技术要点

### 5.1 版本与来源

```ts
type ArtifactSource =
  | { type: 'inline' }           // 消息代码块
  | { type: 'file'; path: string } // 工作区文件

type ArtifactVersion = {
  id: string
  language: 'html' | 'svg'
  code: string
  source: ArtifactSource
  title: string
  createdAt: number
}
```

- `openArtifact`：**总是追加新版本**并激活；相同文件路径再次打开仍追加（便于 diff 心智），标题可用文件名。  
- 版本上限建议 20，超出丢最旧。  
- 关闭面板不丢版本（同会话）；切会话可清空（与 `sessionKey` 绑定更佳，MVP 可先进程级）。

### 5.2 自动打开

- 触发点：`ToolCallCard` 在 `edit` + `completed` + html/svg 时。  
- 若 `autoOpenOnEdit === true`，直接 `read_file_for_preview` + `openArtifact`。  
- 避免在 `in_progress` 时打开半写入文件。

### 5.3 安全

- 维持 sandbox；不增加 `allow-same-origin` 除非有明确需求。  
- 刷新仍走后端路径校验。

---

## 6. 非目标（避免发散）

- 不重做 Figma 矢量编辑器、组件库市场。  
- 不拆独立「Design」进程/窗口（除非用户强烈要求）。  
- 不接 Canva/云协作。  
- 不修改官方 agent 协议只为预览；能在 GUI 层解决就在 GUI 层解决。

---

## 7. 与功能大纲的关系

| 大纲条目 | 与本路线图 |
|----------|------------|
| 附件/图片输入 ⬜ | P1-1 |
| 会话导出 Markdown/PDF ⬜ | 部分重叠 P2-3（设计向导出） |
| MCP / 插件 GUI ⬜ | 正交；Design skill 可后挂 |
| 只加不改官方 | 全文遵守 |

建议：把本文件视为 **Artifact / 设计预览** 专线；大纲第六节优先级表不必被本线打乱——本线改动集中在 `jike-grok-desktop` 前端 + 已有 preview 命令。

---

## 8. 修订记录

| 日期 | 说明 |
|------|------|
| 2026-07-28 | 初版：Claude Design 对照 + MVP/P1/P2；启动 MVP 实现 |
