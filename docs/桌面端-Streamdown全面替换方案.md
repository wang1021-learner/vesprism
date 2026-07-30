# 桌面端 Markdown：Streamdown 全面替换方案

> 状态：**已落地（2026-07-29）**  
> 范围：`crates/jike-grok-desktop` 助手气泡 Markdown 渲染全链路  
> 日期：2026-07-29  
> 依据：Streamdown 官方文档（Unterminated Block Parsing / Memoization / Migrate from react-markdown / Code Blocks / Custom renderers / Components / Security）、落地后的 `AssistantMarkdown.tsx`、Hermes desktop 侧实践对照

---

## 1. 目标与非目标

### 1.1 目标

1. **全面替换**现有 `react-markdown` + `remark-gfm` + `rehype-highlight` + `highlight.js` 栈为 **Streamdown** 体系。
2. **保留并升级** html / svg 代码块「预览」交互（`code-block-with-preview` → 侧栏 `openArtifact`）。
3. 流式阶段获得 **未闭合 Markdown 可渲染**（remend）与 **块级 memo**，减少长回复重解析成本。
4. 定稿后仍有合理的代码高亮（Shiki via `@streamdown/code`，可延迟/懒加载）。
5. 与现有桌面主题（`App.css` CSS 变量）视觉协调，不引入「整页 Tailwind 重做」作为硬前置；允许最小 token + `streamdown/styles.css` 落地。

### 1.2 非目标（本轮不做）

- 不引入完整 shadcn/ui 组件库。
- 不强行接入 Tailwind 整站改造（若后续需要再开专题）；本轮优先 **官方 CSS + 设计 token + 现有 `.md-body` 覆盖**。
- 不改后端 IPC / 会话模型 / `openArtifact` 契约。
- 不在本轮默认启用 Mermaid / KaTeX / CJK 插件（可留扩展位；见 §8）。
- 不替换用户气泡 / 系统气泡 / 思考气泡的纯文本渲染（仍非 Markdown）。

---

## 2. 现状盘点

### 2.1 依赖（`package.json`）

| 包 | 用途 | 替换后 |
|---|---|---|
| `react-markdown` | Markdown → React | **删除** → `streamdown` |
| `remark-gfm` | 表格 / 任务列表 / 删除线 | **删除**（Streamdown 内置 GFM） |
| `rehype-highlight` | 代码高亮 | **删除** → 可选 `@streamdown/code`（Shiki） |
| `highlight.js` | 高亮引擎（间接） | **删除** |

新增：

| 包 | 用途 | 是否必须 |
|---|---|---|
| `streamdown` | 主渲染器 | **必须** |
| `@streamdown/code` | Shiki 高亮 | **建议必须**（否则无语法色） |
| `remend` | 仅若单独使用 | 不单装（随 streamdown） |

### 2.2 代码入口

| 文件 | 角色 |
|---|---|
| `src/components/Chat/AssistantMarkdown.tsx` | **唯一** Markdown 渲染入口 |
| `src/components/Chat/MessageItem.tsx` | 助手消息透传 `streaming` |
| `src/components/Chat/markdownUtils.ts` | `stripHeadingLeadingEmoji`（保留） |
| `src/context/SidePanelContext.tsx` | `openArtifact(lang, code, title?)`（契约不变） |
| `src/App.css` | `.md-body*` 排版；**无** `.code-preview-trigger` 样式（当前类名存在但样式缺失，本轮一并补齐） |
| `src/lib/streamMetrics.ts` | `reportMarkdownCost`（保留指标钩子） |

### 2.3 当前流式策略

```
streaming=true
  → useThrottledValue(text, 45ms)
  → ReactMarkdown + remarkGfm，rehypePlugins=[]（无高亮）
streaming=false
  → stripHeadingLeadingEmoji(text)
  → 先 GFM 无高亮 → 100ms 后挂 rehype-highlight
预览
  → components.code 覆写
  → 用 node.position + text.slice 抠 fence 正文
  → html/svg 外包「预览」按钮 → openArtifact
```

问题：

1. 未闭合 `**` / 链接 / fence 观感差（传统 renderer 行为）。
2. 预览依赖 AST `position`，脆弱。
3. 全量 token 更新时重解析；45ms 节流是手工补偿。
4. highlight.js 生态与 Streamdown/Shiki 分叉，长期双栈不划算。

---

## 3. 目标架构

```
MessageItem (streaming)
    │
    ▼
AssistantMarkdown
    │  displayText = streaming ? throttle(text) : stripHeadingLeadingEmoji(text)
    │
    ▼
Streamdown
    mode / isAnimating / parseIncompleteMarkdown
    plugins.code          ← 延迟挂载 @streamdown/code（定稿后）
    plugins.renderers     ← html/svg 自定义预览块
    controls              ← 复制/下载策略
    className="md-body streamdown-body"
```

### 3.1 预览对接（核心：官方 renderers，不 hack `code`）

使用 **Custom renderers**（文档 [Custom renderers](https://streamdown.ai/docs/custom-renderers)）：

```tsx
// 伪代码 — 实现阶段落地
plugins={{
  code: enableHighlight ? codePlugin : undefined,
  renderers: [
    {
      language: ['html', 'svg'],
      component: HtmlSvgPreviewRenderer,
    },
  ],
}}
```

`HtmlSvgPreviewRenderer` 收到：

| Prop | 用途 |
|---|---|
| `code` | fence 正文（**无需** `node.position` slice） |
| `language` | `html` / `svg` |
| `isIncomplete` | 流式未闭合 → 禁用预览或显示「生成中…」 |

UI 结构建议：

```
CodeBlockContainer / 自定义外壳
  ├─ 代码区（CodeBlock 或 plain <pre>）
  ├─ 内置复制（可选 CodeBlockCopyButton）
  └─ 「预览 HTML|SVG」按钮 → openArtifact(language, code)
```

优先级（Streamdown 文档）：**自定义 renderers > mermaid > 默认 CodeBlock**。  
因此 html/svg 不会掉进默认块而丢预览。

### 3.2 不走 `components.code` 全量覆写的原因

- 文档明确：覆写 `code` 会替换整条代码管线（高亮、mermaid、默认控件全丢）。
- 预览只针对 html/svg；其它语言应保留 Streamdown 默认块。
- 行内 code 用默认或单独 `inlineCode`，避免误伤。

### 3.3 流式 / 定稿行为矩阵

| 阶段 | `mode` | `isAnimating` | `parseIncompleteMarkdown` | `plugins.code` | 预览按钮 |
|---|---|---|---|---|---|
| 流式中 | `"streaming"`（默认） | `true` | `true` | **不挂**（减负） | 可见；`isIncomplete` 时 disabled |
| 刚结束 | `"static"` 或仍 streaming false | `false` | 可关 | 延迟 100ms 再挂 | 可用 |
| 历史消息 | 同定稿 | `false` | 无关紧要 | 挂载 | 可用 |

说明：

- **块级 memo** 由 Streamdown 内部处理；外层 `memo(AssistantMarkdown)` 保留。
- **45ms 节流** 首版 **保留**（与 Hermes  perf 笔记一致：parser 仍可能热）；若 profiling 后块 memo 足够，再下调或去掉。
- **remend** 默认开启，解决未闭合加粗/行内码/链接/fence。
- 流式禁用复制：内置 controls 随 `isAnimating`；我们自定义预览按钮自行读 `isIncomplete`。

### 3.4 未闭合解析（remend）策略

| 能力 | 本轮配置 |
|---|---|
| 未闭合 bold/italic/code/strike | 默认开启 |
| 未闭合链接 | 默认；可选 `remend={{ linkMode: 'text-only' }}` 若链接闪烁影响体验再开 |
| 未闭合图片 | 库侧移除半截图片（文档行为） |
| 关闭总开关 | 仅 debug：`parseIncompleteMarkdown={false}` |

---

## 4. 样式与主题策略（无 Tailwind 前提）

当前项目：**无 Tailwind**，样式在 `App.css`。

### 4.1 推荐落地（全面替换但仍可控）

1. 引入官方：
   ```ts
   import 'streamdown/styles.css'
   ```
2. 在 `App.css` 或 `index.css` 注入 **最小 shadcn 兼容 token**（Streamdown README 要求），映射到现有桌面变量：

   | Streamdown token | 建议映射 |
   |---|---|
   | `--background` / `--card` | `var(--surface-*)` 或聊天底 |
   | `--foreground` | `var(--text-primary)` |
   | `--muted` / `--muted-foreground` | `var(--surface-muted)` / `var(--text-secondary)` |
   | `--border` | `var(--border-solid)` |
   | `--primary` | 品牌强调色 |
   | `--radius` | `0.75rem` 左右对齐现有圆角 |

3. 保留 `.md-body` 作为外层容器，用后代选择器 **收敛** 与现有聊天气泡冲突的间距/字号：
   - 段落、列表、表格字号对齐 15px / 13.5px 现有规格
   - 代码块圆角 12px 与现有 `pre` 一致
4. **补齐** 预览按钮样式（当前 JSX 有类名、CSS 缺失）：
   - `.code-block-with-preview`
   - `.code-preview-trigger`（hover / disabled / 与代码块右上角对齐）

### 4.2 不采用的路径（本轮）

- 整站装 Tailwind + `@source streamdown/dist`：改动面过大，与「先全面换渲染引擎」目标可拆开；若后续要 1:1 Hermes 观感再开。

### 4.3 视觉验收标准

- 明暗主题下代码块背景/边框不「发灰断层」
- 预览按钮不与复制按钮重叠
- 表格横向滚动不撑破聊天气泡
- 行内 code 与 fence 可区分

---

## 5. 依赖与构建变更清单

### 5.1 `package.json`

> **版本核实**（2026-07-29 执行）：
>
> ```text
> npm view streamdown version        → 2.5.0
> npm view @streamdown/code version  → 1.1.1
> ```

```diff
- "highlight.js": "..."
- "react-markdown": "..."
- "rehype-highlight": "..."
- "remark-gfm": "..."
+ "streamdown": "^2.5.0"
+ "@streamdown/code": "^1.1.1"
```

S1 安装命令（验收用）：

```bash
cd crates/jike-grok-desktop
npm install streamdown@^2.5.0 @streamdown/code@^1.1.1
npm uninstall react-markdown remark-gfm rehype-highlight highlight.js
```

### 5.2 入口 import

- `main.tsx` 或 `AssistantMarkdown.tsx`：`import 'streamdown/styles.css'`
- 不在全局再引 highlight.js CSS

### 5.3 Vite / 包体

- `@streamdown/code` **动态 import**（与 Hermes 同思路）：首屏不拖 Shiki 全量 grammar。
- 可选：`vite` manualChunks 把 `shiki` / `@streamdown/code` 拆 chunk（实现阶段按 build 产物调整）。

---

## 6. 代码改动清单（实现顺序）

### PR / 提交建议拆分（可同一分支连续提交）

| 步骤 | 内容 | 验收 |
|---|---|---|
| **S1 依赖** | 安装 streamdown + @streamdown/code；卸载旧四件套；lock 更新 | `npm ls` 无 react-markdown |
| **S2 渲染核心** | 重写 `AssistantMarkdown.tsx` | 助手消息可见 GFM + 流式 remend |
| **S3 预览** | `HtmlSvgPreviewRenderer` + `openArtifact` | 点预览打开侧栏，内容正确 |
| **S4 高亮策略** | 定稿延迟挂 code plugin；流式不挂 | 流式不卡顿；定稿有色 |
| **S5 样式** | styles.css + token 映射 + 预览按钮 CSS + `.md-body` 收敛 | 明暗主题抽检 |
| **S6 清理** | 删无用 import；更新「功能修改说明」或本方案状态为「已落地」 | `npm run build` 通过 |
| **S7 文档** | 本文件状态改为「已实现」；必要时补一行变更日志 | — |

### 6.1 `AssistantMarkdown.tsx` 目标形状（接口保持）

```tsx
// 对外 API 不变，避免 MessageItem 大改
interface AssistantMarkdownProps {
  text: string
  streaming?: boolean
}

export const AssistantMarkdown = memo(function AssistantMarkdown({
  text,
  streaming = false,
}: AssistantMarkdownProps) {
  // openArtifact + throttle + stripHeadingLeadingEmoji
  // return <div className="md-body"><Streamdown ... /></div>
})
```

内部模块建议拆分（可读性，非必须独立文件）：

| 符号 | 职责 |
|---|---|
| `useThrottledValue` | 保留或抽到 hooks |
| `useCodePlugin(enabled)` | 延迟 / 动态 import `@streamdown/code` |
| `HtmlSvgPreviewRenderer` | 预览 + 代码壳 |
| `buildPlugins(enableHighlight)` | `{ code?, renderers }` 稳定引用 |

### 6.2 Metrics

- 保留 `reportMarkdownCost`：在 Streamdown 创建前后用 `performance.now()` + `queueMicrotask` 上报（语义仍是「创建元素近似耗时」，文档注明非 pure parse）。
- 可选后续：按 block 数扩展指标（非本轮必须）。

### 6.3 不改文件（明确）

- `MessageItem.tsx`：仅若 props 不变则 **零 diff**；若要传 `messageId` 等再开。
- `SidePanelContext` / `ArtifactView`：契约不变。
- 思考气泡 / 工具卡：仍非 Streamdown。

---

## 7. 与 Hermes 的对照（避免误抄）

### 7.1 `@assistant-ui/react-streamdown` 信息来源（已核实）

**来源：直接阅读本工作区 Hermes 桌面端源码，非推测。**

| 证据 | 路径 | 内容 |
|---|---|---|
| 依赖声明 | `hermes-agent-review/apps/desktop/package.json` L67–L68、L85、L124 | 见下 |
| 业务 import | `apps/desktop/src/components/assistant-ui/markdown-text.tsx` | `from '@assistant-ui/react-streamdown'`（`StreamdownTextPrimitive` 等） |
| 业务 import | `apps/desktop/src/lib/markdown-blocks.ts` | `parseMarkdownIntoBlocks` |
| 业务 import | `apps/desktop/src/lib/markdown-preprocess.ts` | `normalizeMathDelimiters` |
| 业务 import | `apps/desktop/src/components/chat/shiki-highlighter.tsx` | `SyntaxHighlighterProps` 类型 |
| lock 解析 | `hermes-agent-review/package-lock.json` | 解析到 `@assistant-ui/react-streamdown@0.3.5` |

`apps/desktop/package.json` 当时读到的依赖行：

```json
"@assistant-ui/react": "^0.14.23",
"@assistant-ui/react-streamdown": "^0.3.4",
...
"@streamdown/code": "^1.1.1",
...
"streamdown": "^2.5.0",
```

说明：Hermes **同时**依赖底层 `streamdown` 与 assistant-ui 封装 `@assistant-ui/react-streamdown`。我们本轮 **只引入 `streamdown` + `@streamdown/code`**，不引入 assistant-ui 封装。

### 7.2 对照表

| 点 | Hermes（已核实） | 我们本轮 |
|---|---|---|
| 渲染器 | `streamdown` + `@assistant-ui/react-streamdown` | 仅 `streamdown`（无 assistant-ui） |
| 高亮 | `@streamdown/code` + Shiki 相关 | 同：懒加载 `@streamdown/code` |
| 数学 | KaTeX / remark-math 等 | **本轮不做** |
| 样式 | Tailwind + shadcn 系 | styles.css + token 映射 + App.css |
| 预览 | 无对等 openArtifact | **保留** jike 侧栏预览 |

结论：对齐的是 **引擎与流式哲学**，不是整份 Hermes UI。

---

## 8. 扩展位

| 能力 | 包 | 状态 |
|---|---|---|
| **Tailwind v4** | `tailwindcss` + `@tailwindcss/vite` | **已上**（仅 theme+utilities，无 preflight；`@source` 扫 streamdown 包） |
| **公式 Math** | `@streamdown/math` + `katex` | **已上**（`singleDollarTextMath: true`；`katex.min.css`） |
| **Mermaid** | `@streamdown/mermaid` + `mermaid` | **已上**（异步懒加载，避免拖首屏） |
| CJK 断词/删除线友好 | `@streamdown/cjk` | 延后：中日文排版问题复现后 |
| 动画 caret | `animated` / `caret` props | 延后：设计确认需要「打字感」 |

---

## 9. 风险与缓解

| 风险 | 影响 | 缓解 |
|---|---|---|
| 无 Tailwind 导致控件错位/透明 | 中 | styles.css + token；预览按钮自写 CSS 兜底 |
| Shiki 包体大 | 中 | 动态 import；流式不加载 |
| 块 memo + 外层 throttle 双重延迟 | 低 | 先 45ms；验收后可调 32/0 |
| remend 误补语法 | 低 | 文档已有 code/list 保护；异常用例记回归 |
| 自定义 renderer 与默认 CodeBlock 样式不一致 | 中 | 复用导出的 `CodeBlock*` 组件 |
| 流式点预览半截 HTML | 中 | `isIncomplete` 时 disabled + title 提示 |
| `stripHeadingLeadingEmoji` 与 remend 顺序 | 低 | **先 strip（仅定稿）再进 Streamdown**；流式不 strip 减少抖动 |
| 安全（见 §9.1） | 中 | 默认 **并非**「最严 harden」；见下文官方依据与本轮策略 |

### 9.1 安全依据（官方 Security 文档，已阅读）

**文档 URL（已确认可达）：** https://streamdown.ai/docs/security  

以下为文档要点摘要（实现与评审以原文为准，勿只记「默认 harden」）。

#### 9.1.1 两层防护机制（原文结构）

Streamdown 使用两层保护：

1. **`rehype-sanitize`** — strips dangerous HTML elements and attributes using GitHub's sanitization schema, extended with `tel:` protocol support  
2. **`rehype-harden`** — restricts URL protocols, link domains, and image sources  

#### 9.1.2 默认净化了什么 / 默认有多严

文档 **Default Security** 明确写明：默认是 **permissive security**（偏宽松，优先功能），**不是**「默认锁死外链」。

默认 `rehype-harden` 配置（文档示例）：

```js
// Default rehype-harden configuration
{
  allowedImagePrefixes: ["*"],  // All images allowed
  allowedLinkPrefixes: ["*"],   // All links allowed
  allowedProtocols: ["*"],      // All protocols allowed
  defaultOrigin: undefined,     // No origin restriction
  allowDataImages: true,        // Base64 images allowed
}
```

默认 `rehype-sanitize` 对链接协议允许：`http`、`https`、`irc`、`ircs`、`mailto`、`xmpp`、`tel`。

文档原意：*This works well for trusted content but should be tightened for untrusted sources.*

**可收紧项（文档提供的开关，均通过自定义 `rehypePlugins` 覆盖默认数组）：**

| 能力 | 默认 | 如何收紧（文档） |
|---|---|---|
| URL 协议 `allowedProtocols` | `["*"]` | 改为 `http` / `https` / `mailto` 等白名单 |
| 链接域 `allowedLinkPrefixes` | `["*"]` | 前缀白名单；不匹配会重写到 `defaultOrigin` / 表现为 blocked |
| 图片域 `allowedImagePrefixes` | `["*"]` | 同理白名单 |
| `allowDataImages` | `true` | 设 `false` 禁用 `data:image/...` |
| `defaultOrigin` | `undefined` | 设应用源，用于相对 URL 与拦截回落 |
| 原始 HTML | 默认走 `rehype-raw` | **省略** `defaultRehypePlugins.raw` 则 HTML 被转义成文本 |
| 忽略 HTML | — | `skipHtml` prop：完全忽略 raw HTML（非转义展示） |
| 自定义标签 | 未知标签被 strip（保留文本内容） | `allowedTags` 白名单属性；仅默认 rehype 栈生效 |
| `urlTransform` | 默认 passthrough | 自定义改写；文档称 URL 安全已由 sanitize + harden 处理 |

**重要：** 覆盖 `rehypePlugins` 时 **整表替换、不 merge**。文档要求：若自配，**必须**仍包含 `defaultRehypePlugins.sanitize` 以保留 XSS 防护。

#### 9.1.3 html / svg **代码块**是否有额外限制

Security 文档 **没有**单独章节规定「` ```html ` / ` ```svg ` fence 内字符串」的额外净化规则。

文档讨论的 HTML 安全主要针对：

- Markdown 中的 **raw HTML**（`rehype-raw` + sanitize/harden）
- **链接 / 图片 URL**（harden 前缀与协议）
- 自定义 HTML 标签（`allowedTags`）

对 **fenced code blocks**：

- 默认路径是作为 **代码文本** 渲染（高亮/复制），**不会**因 fence 语言是 html/svg 就在气泡内执行脚本。
- 我们的「预览」是 **自定义 renderer → `openArtifact` → 侧栏**，执行/展示边界在 **既有 Artifact 侧栏沙箱**，不在 Streamdown 默认 CodeBlock 内。
- 因此：Streamdown Security 文档 **不能**替代侧栏 artifact 的安全评审；本轮仍依赖既有 `ArtifactView` / iframe 策略。

#### 9.1.4 本轮安全策略（基于上文，实施时落地）

| 项 | 本轮决定 |
|---|---|
| 首版是否收紧 harden | **首版跟库默认（permissive）**，与「先换引擎」节奏一致；AI 内容若需收紧，在后续 PR 用文档推荐的 AI 配置收紧 `allowedProtocols` / 关 `allowDataImages` |
| 是否去掉 `rehype-raw` | **首版不主动去掉**（保持库默认）；若验收发现 raw HTML 可注入 UI，再改为 omit raw + 保留 sanitize |
| html/svg 预览 | **仅**通过侧栏 `openArtifact`；renderer 内 **不** `dangerouslySetInnerHTML` |
| 流式未闭合预览 | `isIncomplete` 时禁用按钮，降低半截文档误执行风险（体验+安全） |
| 禁止事项 | 不 `allowedTags` 放行 `script` / 事件处理器；不自写绕过 sanitize 的 rehype 栈 |

---

## 10. 测试与验收清单

### 10.1 功能

- [ ] GFM：表格、任务列表、删除线、自动链接
- [ ] 行内 code / 多语言 fence
- [ ] ````html` / ````svg` 出现「预览」按钮；点击侧栏 iframe/预览正确
- [ ] 其它语言 **无** 预览按钮，有复制（若 controls 开启）
- [ ] 流式：未闭合 `**bold`、未闭合 fence 不碎版
- [ ] 流式：未闭合 html fence 预览 disabled；闭合后可点
- [ ] 定稿：语法高亮出现（延迟可接受）
- [ ] 历史消息重开会话：渲染与预览正常
- [ ] 标题 leading emoji strip 仅定稿生效

### 10.2 性能 / 体验

- [ ] 长回复（>5k tokens）流式滚动可跟底
- [ ] 切换会话无残留定时器 / 错高亮闪一下可接受
- [ ] `npm run build` 通过；主 chunk 增长可解释（shiki 应在 async chunk）

### 10.3 回归

- [ ] 用户 / 系统 / 思考 / 工具卡 不受影响
- [ ] 工具卡自身「预览 HTML」路径（`ToolCallCard`）不受 Markdown 替换影响

---

## 11. 回滚方案

1. Git 回退本替换相关提交。
2. 或短期 feature flag（**可选，实现阶段决定**）：
   ```ts
   const USE_STREAMDOWN = true // 紧急 false 时恢复旧实现需保留旧文件分支
   ```
   全面替换策略下 **不保留双栈长期并存**；回滚靠 git。若上线窗口紧，允许 **一个 release 内** 用 flag 切回，下一 release 删旧代码。

---

## 12. 决策摘要（已定）

| 项 | 决定 |
|---|---|
| 是否全面替换 | **是** |
| 预览对接方式 | **`plugins.renderers`（html/svg）**，不用 position hack |
| 高亮 | **`@streamdown/code` 懒加载 + 定稿延迟挂载** |
| 依赖版本（npm view 已核实） | **`streamdown@^2.5.0`**（registry 当前 `2.5.0`）、**`@streamdown/code@^1.1.1`**（registry 当前 `1.1.1`） |
| Tailwind | **已引入 v4**：仅 theme+utilities、无 preflight；`@source` 扫 streamdown；token 映射现有主题 |
| 节流 45ms | **首版保留**，后续 profiling 再砍 |
| Math/Mermaid | **已上**；CJK 仍延后 |
| 对外 props | **`AssistantMarkdown({ text, streaming })` 不变** |
| 安全默认 | 跟库 **permissive** 默认；不误称「默认 harden 最严」；预览走侧栏沙箱 |

---

## 13. 实现启动检查表（改代码前勾选）

- [x] Hermes `@assistant-ui/react-streamdown` 来源已用源码核实（§7.1）
- [x] Streamdown Security 文档已读，§9.1 已写明默认 permissive 与可配置项
- [x] `npm view` 版本已核实：`streamdown@2.5.0`、`@streamdown/code@1.1.1`（§5.1 / §12）
- [x] 产品确认按「全面替换一步到位」推进（用户指令）
- [x] 不强制本轮上 Tailwind（用 `[data-streamdown]` + token）
- [x] html/svg 预览仍走侧栏 `openArtifact`
- [x] 版本号策略：`^2.5.0` / `^1.1.1`
- [x] S1–S7 已落地，`npm run build` 通过

---

## 14. 参考链接

- Streamdown：https://streamdown.ai/docs  
- Security：https://streamdown.ai/docs/security  
- Migrate：https://streamdown.ai/docs/migrate  
- Unterminated：https://streamdown.ai/docs/termination  
- Memoization：https://streamdown.ai/docs/memoization  
- Code blocks：https://streamdown.ai/docs/code-blocks  
- Custom renderers：https://streamdown.ai/docs/custom-renderers  
- Components：https://streamdown.ai/docs/components  
- 现实现：`crates/jike-grok-desktop/src/components/Chat/AssistantMarkdown.tsx`  
- 流式背景：`crates/jike-grok-desktop/功能修改说明-滚动条与流式输出.md`  
- Hermes 依赖：`hermes-agent-review/apps/desktop/package.json`

---

## 15. 变更记录

| 日期 | 说明 |
|---|---|
| 2026-07-29 | 初稿：全面替换方案，待确认后实施 |
| 2026-07-29 | 核实三项：Hermes 包名源码出处、Security 文档写入 §9.1、npm 版本 2.5.0 / 1.1.1 写入 §5.1/§12；**仍未启动 S1** |
| 2026-07-29 | **全面落地**：`streamdown@2.5.0` + `@streamdown/code@1.1.1`；重写 `AssistantMarkdown`；`App.css` 用 design token + `[data-streamdown]` 适配（无 Tailwind）；html/svg `plugins.renderers` 预览；`npm run build` 通过 |
| 2026-07-29 | **补齐扩展**：Tailwind v4（无 preflight）+ `@streamdown/math`/`katex`（含 `$` 行内）+ `@streamdown/mermaid` 懒加载 |
