# 钩子示例（中文翻译）

> **⚠️ 免责声明**：本文件是对英文原版 `README.md` 的中文翻译，仅供参考。以英文原版 [`README.md`](README.md) 为准。

---

Grok 的示例钩子。复制到 `~/.grok/hooks/` 可全局启用，或复制到 `<project>/.grok/hooks/` 用于项目级钩子（需要 `/hooks-trust`）。

## 可用示例

### 1. 安全 Shell 守卫（`safe-shell.json`）

**类型：** 阻塞式（`PreToolUse`）

在执行前拒绝明显破坏性的 shell 命令：
- `rm -rf /`、`sudo rm -rf`、`mkfs`、对设备的 `dd`、fork 炸弹

**安装：**
```sh
mkdir -p ~/.grok/hooks/bin
cp examples/hooks/safe-shell.json ~/.grok/hooks/
cp examples/hooks/bin/safe-shell-guard.sh ~/.grok/hooks/bin/
chmod +x ~/.grok/hooks/bin/safe-shell-guard.sh
```

### 2. 禁止递归 Grep（`no-recursive-grep.json`）

**类型：** 阻塞式（`PreToolUse`）

在执行前拒绝 shell 中的递归 `grep` 调用：
- `grep -r`、`grep -R`、`grep --recursive`、`grep --dereference-recursive`、
  `grep -d recurse`、聚集标志（`grep -rn`、`grep -nri`）和 `rgrep`

递归 grep 会把整个目录树加载到内存中，可能在大仓库上导致代理进程 OOM 被杀。
系统提示已经引导模型远离这种方式，但提示只是建议性的 — 本钩子使其成为硬性、确定性的阻止。
引导模型使用专用搜索工具（基于 ripgrep）。

注意避免误报：`ls -R | grep foo`（`-R` 属于 `ls`）、
`grep -e -r file`（`-r` 是模式）和 `grep -- -r file` 都被允许。

**安装：**
```sh
mkdir -p ~/.grok/hooks/bin
cp examples/hooks/no-recursive-grep.json ~/.grok/hooks/
cp examples/hooks/bin/no-recursive-grep-guard.py ~/.grok/hooks/bin/
chmod +x ~/.grok/hooks/bin/no-recursive-grep-guard.py
```
（需要 `python3` 在 `PATH` 中。）

### 3. 会话审计日志（`session-log.json`）

**类型：** 被动式（`SessionStart` + `SessionEnd`）

将会话元数据追加到 `~/.grok/session-audit.log` — 事件、会话 ID、cwd、时间戳。

**安装：**
```sh
mkdir -p ~/.grok/hooks/bin
cp examples/hooks/session-log.json ~/.grok/hooks/
cp examples/hooks/bin/session-log.sh ~/.grok/hooks/bin/
chmod +x ~/.grok/hooks/bin/session-log.sh
```

### 4. 工具活动日志记录器（`tool-logger.json`）

**类型：** 被动式（`PreToolUse` + `PostToolUse`）

将所有工具调用记录到 `~/.grok/tool-activity.log` — 工具名称、事件类型、有效工具名称、后台状态。

**安装：**
```sh
mkdir -p ~/.grok/hooks/bin
cp examples/hooks/tool-logger.json ~/.grok/hooks/
cp examples/hooks/bin/tool-logger.sh ~/.grok/hooks/bin/
chmod +x ~/.grok/hooks/bin/tool-logger.sh
```

## 格式

钩子文件使用 Claude 兼容的 JSON 格式：

```json
{
  "hooks": {
    "PreToolUse": [
      {
        "matcher": "Bash",
        "hooks": [
          { "type": "command", "command": "bin/check.sh", "timeout": 5 }
        ]
      }
    ]
  }
}
```

- **事件名称：** `SessionStart`、`PreToolUse`、`PostToolUse`、`SessionEnd`
- **匹配器：** 工具名上的正则。Claude 名称如 `Bash`、`Read`、`Edit` 会自动扩展以同时匹配 Grok 名称（`run_terminal_cmd`、`read_file`、`search_replace`）
- **超时：** 秒（默认：5）
- **命令：** 脚本路径（相对于钩子文件目录）或内联 shell 命令

## 脚本契约

脚本通过 **stdin** 接收钩子事件信封作为 JSON，并将响应写入 **stdout**：

**阻塞式钩子（`PreToolUse`）：**
```json
{"decision":"allow"}
```
或
```json
{"decision":"deny","reason":"Explanation for the user"}
```

**退出码：** `0` = 允许，`2` = 拒绝，其他 = 失败开放。

**被动式钩子：** stdout 仅供参考。退出 `0` 表示成功。

## 卸载

从 `~/.grok/hooks/` 中移除 JSON 文件。钩子在下次会话中停止运行。
