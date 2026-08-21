import { describe, expect, it } from 'vitest'
import { createDemoDraft, draftHasAbsolutePath } from './graph'
import { compileToRhai, listReachable } from './rhai'
import type { FlowDraft } from './types'

describe('compileToRhai', () => {
  it('三节点 demo 导出可被官方发现的 meta + agent + complete', () => {
    const rhai = compileToRhai(createDemoDraft())
    expect(rhai).toContain('let meta = #{')
    expect(rhai).toContain('name: "demo-linear"')
    expect(rhai).toContain('phase("摘要 · agent-1")')
    expect(rhai).toContain('agent(')
    expect(rhai).toContain('complete(')
    expect(rhai).not.toMatch(/position/)
    expect(rhai).not.toMatch(/[A-Za-z]:[\\/]/)
    expect(listReachable(createDemoDraft()).sort()).toEqual(['agent-1', 'end-1', 'start-1'])
  })

  it('branch 生成 if / else；未内联的 flow 节点拒绝编译', () => {
    const draft: FlowDraft = {
      id: 'with-branch',
      name: '分支示例',
      description: '给 agent 看的说明',
      version: '1',
      input_schema: { type: 'object' },
      output_schema: { type: 'object' },
      nodes: [
        { id: 's', type: 'start', params: { label: '起点' } },
        { id: 'b', type: 'branch', params: { condition: 'success' } },
        { id: 'ok', type: 'agent', params: { label: '成功', prompt: '处理成功' } },
        { id: 'ng', type: 'tool', params: { command: 'echo fail' } },
        { id: 'e', type: 'end', params: {} },
      ],
      edges: [
        { from: 's', to: 'b' },
        { from: 'b', to: 'ok', label: 'success' },
        { from: 'b', to: 'ng', label: 'failure' },
        { from: 'ok', to: 'e' },
        { from: 'ng', to: 'e' },
      ],
    }
    const rhai = compileToRhai(draft)
    expect(rhai).toContain('if (')
    expect(rhai).toContain('} else {')
    expect(rhai).toContain('处理成功')
    expect(rhai).toContain('capability_mode: "execute"')
    expect(rhai).not.toContain('invoke')
    expect(() =>
      compileToRhai({
        ...draft,
        nodes: draft.nodes.map((n) =>
          n.id === 'ok' ? { ...n, type: 'flow', params: { flowId: 'other-flow' } } : n,
        ),
      }),
    ).toThrow(/未内联/)
  })

  it('Agent 解析进 AgentOpts，不写进提示词', () => {
    const d = createDemoDraft()
    ;(d.nodes[1].params as { presetId?: string }).presetId = 'coding'
    expect(() => compileToRhai(d)).toThrow(/Agent「coding」不存在/)
    const rhai = compileToRhai(d, {
      presets: { coding: { model: 'grok-4', agentType: 'explore' } },
    })
    expect(rhai).toContain('model: "grok-4"')
    expect(rhai).toContain('agent_type: "explore"')
    expect(rhai).not.toContain('你按组装单')
  })

  it('Agent 的 capability / isolation / output_schema / disabled_tools / permission_rules 编译进官方 AgentOpts', () => {
    const d = createDemoDraft()
    ;(d.nodes[1].params as { presetId?: string }).presetId = 'auditor'
    const rhai = compileToRhai(d, {
      presets: {
        auditor: {
          capability: 'read-only',
          isolation: true,
          outputSchema: { type: 'object', properties: { ok: { type: 'boolean' } }, required: ['ok'] },
          disabledTools: ['web_search', 'Name:shell'],
          permissionRules: ['edit:**/.env', 'web_*'],
        },
      },
    })
    expect(rhai).toContain('capability_mode: "read-only"')
    expect(rhai).toContain('isolation_worktree: true')
    expect(rhai).toContain('output_schema: #{ "type": "object"')
    expect(rhai).toContain('"required": ["ok"]')
    expect(rhai).toContain('disabled_tools: ["web_search", "Name:shell"]')
    expect(rhai).toContain('permission_rules: ["edit:**/.env", "web_*"]')
  })

  it('节点显式 read_only / isolation:false 覆盖 Agent 源', () => {
    const d = createDemoDraft()
    Object.assign(d.nodes[1].params, {
      presetId: 'auditor',
      capability: 'read_only',
      isolation: false,
    })
    const rhai = compileToRhai(d, {
      presets: {
        auditor: { capability: 'all', isolation: true },
      },
    })
    expect(rhai).toContain('capability_mode: "read-only"')
    expect(rhai).toContain('isolation_worktree: false')
    expect(rhai).not.toContain('isolation_worktree: true')
  })

  it('无 capability/isolation/outputSchema/disabledTools/permissionRules 时，不输出这些字段', () => {
    const rhai = compileToRhai(createDemoDraft())
    expect(rhai).not.toContain('capability_mode: "read-only"')
    expect(rhai).not.toContain('isolation_worktree')
    expect(rhai).not.toContain('output_schema:')
    expect(rhai).not.toContain('disabled_tools:')
    expect(rhai).not.toContain('permission_rules:')
  })

  it('Agent 具备 skills 时，将其正确注入到提示词中下发', () => {
    const draft = createDemoDraft()
    ;(draft.nodes[1].params as { presetId?: string }).presetId = 'code-reviewer'
    const rhaiWithPreset = compileToRhai(draft, {
      presets: {
        'code-reviewer': {
          skills: ['git-workflow', 'security-audit'],
        },
      },
    })
    expect(rhaiWithPreset).toContain('skills: ["git-workflow", "security-audit"]')
  })

  it('Agent 具备 systemPrompt / description 时，将其正确注入到提示词中下发', () => {
    const draft = createDemoDraft()
    ;(draft.nodes[1].params as { presetId?: string }).presetId = 'security-expert'
    const rhai = compileToRhai(draft, {
      presets: {
        'security-expert': {
          name: '安全专家',
          description: '专项审查安全漏洞',
          systemPrompt: '你是资深安全专家，负责审查所有外部输入与越权漏洞。',
        },
      },
    })
    expect(rhai).toContain('你是资深安全专家，负责审查所有外部输入与越权漏洞。')
  })

  it('草稿含绝对路径时被检测', () => {
    const d = createDemoDraft()
    expect(draftHasAbsolutePath(d)).toBeNull()
    ;(d.nodes[1].params as { prompt?: string }).prompt = 'read C:\\\\Users\\\\me\\\\secret.txt'
    expect(draftHasAbsolutePath(d)).toMatch(/绝对路径/)
  })

  it('正确编译官方原生 parallel() 并发扇出与 join 汇聚节点', () => {
    const draft: FlowDraft = {
      id: 'parallel-flow',
      name: '并行流程',
      description: '并行执行多任务并聚合结果',
      version: '1',
      input_schema: { type: 'object' },
      output_schema: { type: 'object' },
      nodes: [
        { id: 's', type: 'start', params: { label: '起点' } },
        { id: 'par', type: 'parallel', params: { label: '分发' } },
        { id: 'task1', type: 'agent', params: { label: '任务1', prompt: '执行任务1' } },
        { id: 'task2', type: 'agent', params: { label: '任务2', prompt: '执行任务2' } },
        { id: 'j', type: 'join', params: { label: '聚合', mergeMode: 'merge_json' } },
        { id: 'e', type: 'end', params: {} },
      ],
      edges: [
        { from: 's', to: 'par' },
        { from: 'par', to: 'task1' },
        { from: 'par', to: 'task2' },
        { from: 'task1', to: 'j' },
        { from: 'task2', to: 'j' },
        { from: 'j', to: 'e' },
      ],
    }
    const rhai = compileToRhai(draft)
    expect(rhai).toContain('parallel fan-out (2 branches)')
    expect(rhai).toContain('let par_par_jobs = [];')
    expect(rhai).toContain('par_par_jobs.push(')
    expect(rhai).toContain('let par_par = parallel(par_par_jobs);')
    expect(rhai).toContain('join (mode: merge_json)')
    expect(rhai).toContain('complete(')
  })

  it('HTTP 节点编译成带真实请求说明的 execute agent 调用（URL/方法/头/体全量入 prompt）', () => {
    const draft: FlowDraft = {
      id: 'http-flow',
      name: 'HTTP 请求流程',
      description: '发起一次外部 HTTP 请求',
      version: '1',
      input_schema: { type: 'object' },
      output_schema: { type: 'object' },
      nodes: [
        { id: 's', type: 'start', params: { label: '起点' } },
        {
          id: 'h',
          type: 'http',
          params: {
            label: '拉取任务',
            url: 'https://api.example.com/v1/tasks',
            method: 'POST',
            headers: 'Content-Type: application/json\nAuthorization: Bearer tok',
            body: '{"name":"demo"}',
          },
        },
        { id: 'e', type: 'end', params: {} },
      ],
      edges: [
        { from: 's', to: 'h' },
        { from: 'h', to: 'e' },
      ],
    }
    const rhai = compileToRhai(draft)
    expect(rhai).toContain('log("node h http")')
    expect(rhai).toContain('发起一次真实的 HTTP POST 请求到「https://api.example.com/v1/tasks」')
    expect(rhai).toContain('Content-Type: application/json')
    expect(rhai).toContain('{\\"name\\":\\"demo\\"}')
    expect(rhai).toContain('禁止伪造或编造响应')
    expect(rhai).toContain('kind: "http"')
    expect(rhai).toContain('capability_mode: "execute"')
    expect(rhai).toContain('complete(')
  })

  it('agent 节点 maxOutputTokens 透传官方 max_output_tokens；retry 编译成真实重试循环', () => {
    const d = createDemoDraft()
    Object.assign(d.nodes[1].params, { maxOutputTokens: 4096, retry: 2 })
    const rhai = compileToRhai(d)
    expect(rhai).toContain('max_output_tokens: 4096')
    expect(rhai).toContain('for attempt in 0..3 {')
    expect(rhai).toContain('break;')
    expect(rhai).toContain('agent failed after 3 attempts')
    // 不设 retry 时不生成循环
    const plain = compileToRhai(createDemoDraft())
    expect(plain).not.toContain('for attempt in')
    expect(plain).not.toContain('max_output_tokens:')
  })

  it('agent/tool/http 节点 timeoutSecs 编译成官方 timeout_ms 真超时', () => {
    const draft: FlowDraft = {
      id: 'timeout-flow',
      name: '超时流程',
      description: '真超时',
      version: '1',
      input_schema: { type: 'object' },
      output_schema: { type: 'object' },
      nodes: [
        { id: 's', type: 'start', params: { label: '起点' } },
        { id: 'a', type: 'agent', params: { label: '分析', prompt: '分析', timeoutSecs: 120 } },
        { id: 't', type: 'tool', params: { command: 'npm test', timeoutSecs: 60 } },
        { id: 'h', type: 'http', params: { url: 'https://api.example.com/x', timeoutSecs: 30 } },
        { id: 'e', type: 'end', params: {} },
      ],
      edges: [
        { from: 's', to: 'a' },
        { from: 'a', to: 't' },
        { from: 't', to: 'h' },
        { from: 'h', to: 'e' },
      ],
    }
    const rhai = compileToRhai(draft)
    expect(rhai).toContain('timeout_ms: 120000')
    expect(rhai).toContain('timeout_ms: 60000')
    expect(rhai).toContain('timeout_ms: 30000')
    // 未设 timeoutSecs 时不输出
    const plain = compileToRhai(createDemoDraft())
    expect(plain).not.toContain('timeout_ms')
  })

  it('tool/http 节点 retry 编译成重试循环', () => {
    const draft: FlowDraft = {
      id: 'retry-flow',
      name: '重试流程',
      description: '验证工具与 HTTP 节点重试',
      version: '1',
      input_schema: { type: 'object' },
      output_schema: { type: 'object' },
      nodes: [
        { id: 's', type: 'start', params: { label: '起点' } },
        { id: 't', type: 'tool', params: { command: 'curl -s http://localhost:1', retry: 1 } },
        { id: 'h', type: 'http', params: { url: 'https://api.example.com/x', method: 'GET', retry: 3 } },
        { id: 'e', type: 'end', params: {} },
      ],
      edges: [
        { from: 's', to: 't' },
        { from: 't', to: 'h' },
        { from: 'h', to: 'e' },
      ],
    }
    const rhai = compileToRhai(draft)
    expect(rhai).toContain('for attempt in 0..2 {')
    expect(rhai).toContain('for attempt in 0..4 {')
    expect(rhai).toContain('tool failed after 2 attempts')
    expect(rhai).toContain('http failed after 4 attempts')
  })

  it('{{}} 运行时替换：agent prompt 里 {{prev.output}} 编译成变量拼接', () => {
    const d = createDemoDraft()
    ;(d.nodes[1].params as { prompt?: string }).prompt = '请分析 {{prev.output}} 的数据，文件是 {{start.input}}'
    const rhai = compileToRhai(d)
    expect(rhai).toContain('prompt: "请分析 " + input.output.to_string() + " 的数据，文件是 " + input.to_string()')
  })

  it('变量节点：字符串/数字/JSON/{{}} 引用编译', () => {
    const draft: FlowDraft = {
      id: 'var-flow',
      name: '变量流程',
      description: '变量节点',
      version: '1',
      input_schema: { type: 'object' },
      output_schema: { type: 'object' },
      nodes: [
        { id: 's', type: 'start', params: { label: '起点' } },
        { id: 'c', type: 'variable', params: { label: '常量', value: '42', valueType: 'number' } },
        { id: 'v', type: 'variable', params: { label: '引用', value: '{{prev.output}}' } },
        { id: 'e', type: 'end', params: {} },
      ],
      edges: [
        { from: 's', to: 'c' },
        { from: 'c', to: 'v' },
        { from: 'v', to: 'e' },
      ],
    }
    const rhai = compileToRhai(draft)
    expect(rhai).toContain('node c variable')
    expect(rhai).toContain('let c = 42;')
    expect(rhai).toContain('node v variable')
    // 纯 {{prev.output}} → 前一个节点的内容字段（c.output），不带引号
    expect(rhai).toContain('let v = c.output;')
    expect(rhai).not.toContain('let v = "c"')
  })

  it('Transform 节点：块作用域绑定 input（不做文本替换），异常 complete 报错', () => {
    const draft: FlowDraft = {
      id: 'tf-flow',
      name: '变换流程',
      description: '代码节点',
      version: '1',
      input_schema: { type: 'object' },
      output_schema: { type: 'object' },
      nodes: [
        { id: 's', type: 'start', params: { label: '起点' } },
        { id: 't', type: 'transform', params: { label: '变换', code: 'input.items.map(|x| #{ n: x.name })' } },
        { id: 'e', type: 'end', params: {} },
      ],
      edges: [
        { from: 's', to: 't' },
        { from: 't', to: 'e' },
      ],
    }
    const rhai = compileToRhai(draft)
    expect(rhai).toContain('node t transform')
    expect(rhai).toContain('try {')
    // 块作用域绑定：{ let input = <上游>; (code) }——code 原样，不做 \binput\b 文本替换
    expect(rhai).toContain('t = { let input = input; (input.items.map(|x| #{ n: x.name })) };')
    expect(rhai).toContain('catch (err)')
    expect(rhai).toContain('err.to_string()')
  })

  it('Transform 节点：字符串/属性里的 input 不被误替换', () => {
    const draft: FlowDraft = {
      id: 'tf-safe',
      name: '安全变换',
      description: '不误伤',
      version: '1',
      input_schema: { type: 'object' },
      output_schema: { type: 'object' },
      nodes: [
        { id: 's', type: 'start', params: { label: '起点' } },
        { id: 'a', type: 'agent', params: { label: '上游', prompt: '生成数据' } },
        { id: 't', type: 'transform', params: { label: '变换', code: '"the input is " + input.title' } },
        { id: 'e', type: 'end', params: {} },
      ],
      edges: [
        { from: 's', to: 'a' },
        { from: 'a', to: 't' },
        { from: 't', to: 'e' },
      ],
    }
    const rhai = compileToRhai(draft)
    // 上游变量名是 a（不是 input）：块作用域绑定下 code 原样，字符串里的 input 保留
    expect(rhai).toContain('{ let input = a; ("the input is " + input.title) }')
    expect(rhai).not.toContain('the a is')
  })

  it('For-Each 迭代：loop→body→loop_end 编译成 Rhai for 循环，循环体内 prev.output=item', () => {
    const draft: FlowDraft = {
      id: 'loop-flow',
      name: '迭代流程',
      description: '遍历数组逐个处理',
      version: '1',
      input_schema: { type: 'object' },
      output_schema: { type: 'object' },
      nodes: [
        { id: 's', type: 'start', params: { label: '起点' } },
        { id: 'l', type: 'loop', params: { label: '遍历' } },
        { id: 'b', type: 'agent', params: { label: '处理', prompt: '处理 {{prev.output}}' } },
        { id: 'le', type: 'loop_end', params: { label: '汇聚' } },
        { id: 'e', type: 'end', params: {} },
      ],
      edges: [
        { from: 's', to: 'l' },
        { from: 'l', to: 'b' },
        { from: 'b', to: 'le' },
        { from: 'le', to: 'e' },
      ],
    }
    const rhai = compileToRhai(draft)
    expect(rhai).toContain('node l loop over input')
    expect(rhai).toContain('let loop_l_arr = input;')
    expect(rhai).toContain('let loop_l_res = [];')
    expect(rhai).toContain('for item in loop_l_arr {')
    // 循环体内 prompt 里 {{prev.output}} → item 的内容字段（item.output）
    expect(rhai).toContain('prompt: "处理 " + item.output.to_string()')
    expect(rhai).toContain('loop_l_res.push(b);')
    // loop_end 透传结果数组到 complete
    expect(rhai).toContain('output: loop_l_res')
  })

  it('tool/http 的 timeoutSecs 与 outputSchema：超时进任务说明，schema 透传官方 output_schema', () => {
    const draft: FlowDraft = {
      id: 'cfg-flow',
      name: '配置流程',
      description: '超时与输出结构',
      version: '1',
      input_schema: { type: 'object' },
      output_schema: { type: 'object' },
      nodes: [
        { id: 's', type: 'start', params: { label: '起点' } },
        {
          id: 't',
          type: 'tool',
          params: {
            command: 'npm test',
            retry: 0,
            timeoutSecs: 90,
            outputSchema: { type: 'object', properties: { ok: { type: 'boolean' } }, required: ['ok'] },
          },
        },
        {
          id: 'h',
          type: 'http',
          params: { url: 'https://api.example.com/x', timeoutSecs: 30 },
        },
        { id: 'e', type: 'end', params: {} },
      ],
      edges: [
        { from: 's', to: 't' },
        { from: 't', to: 'h' },
        { from: 'h', to: 'e' },
      ],
    }
    const rhai = compileToRhai(draft)
    // tool：timeout_secs 字段进任务 map
    expect(rhai).toContain('timeout_secs: 90')
    // tool：output_schema 透传进 agent opts
    expect(rhai).toContain('output_schema: #{ "type": "object", "properties": #{ "ok": #{ "type": "boolean" } }, "required": ["ok"] }')
    // http：超时写进 prompt 说明
    expect(rhai).toContain('请求必须设置超时：30 秒内无响应即视为失败')
    // 未设 timeoutSecs 时不输出
    const plain = compileToRhai(createDemoDraft())
    expect(plain).not.toContain('timeout_secs')
  })

  it('{{节点id.output}} 引用上游节点输出；引用不存在的节点在编译期报错', () => {
    const draft: FlowDraft = {
      id: 'upstream-flow',
      name: '上游引用',
      description: '点选绑定',
      version: '1',
      input_schema: { type: 'object' },
      output_schema: { type: 'object' },
      nodes: [
        { id: 's', type: 'start', params: { label: '起点' } },
        { id: 'extract', type: 'transform', params: { label: '提取', code: 'input' } },
        { id: 'a', type: 'agent', params: { label: '使用', prompt: '处理 {{extract.output}} 的数据' } },
        { id: 'e', type: 'end', params: {} },
      ],
      edges: [
        { from: 's', to: 'extract' },
        { from: 'extract', to: 'a' },
        { from: 'a', to: 'e' },
      ],
    }
    const rhai = compileToRhai(draft)
    // {{extract.output}} → extract 的内容字段（extract.output）
    expect(rhai).toContain('prompt: "处理 " + extract.output.to_string() + " 的数据"')
    // 引用不存在的节点 → 编译报错
    const bad: FlowDraft = {
      ...draft,
      nodes: draft.nodes.map((n) =>
        n.id === 'a'
          ? { ...n, params: { ...n.params, prompt: '处理 {{ghost-node.output}}' } }
          : n,
      ),
    }
    expect(() => compileToRhai(bad)).toThrow(/不存在/)
  })

  it('database/knowledge 节点编译成调用内置 MCP 工具的 execute agent 任务', () => {
    const draft: FlowDraft = {
      id: 'mcp-flow',
      name: '数据流程',
      description: '数据库与知识库',
      version: '1',
      input_schema: { type: 'object' },
      output_schema: { type: 'object' },
      nodes: [
        { id: 's', type: 'start', params: { label: '起点' } },
        { id: 'd', type: 'database', params: { label: '查库', sql: 'SELECT * FROM t WHERE id = {{prev.output.id}}', dbPath: 'C:\\data\\app.sqlite', retry: 1 } },
        { id: 'k', type: 'knowledge', params: { label: '检索', knowledgeBase: 'docs', query: '重试 OR 超时', limit: 3 } },
        { id: 'e', type: 'end', params: {} },
      ],
      edges: [
        { from: 's', to: 'd' },
        { from: 'd', to: 'k' },
        { from: 'k', to: 'e' },
      ],
    }
    const rhai = compileToRhai(draft)
    // database
    expect(rhai).toContain('node d database')
    expect(rhai).toContain('用 database_query 工具对本地 SQLite 数据库真实执行 SQL')
    // {{prev.output.id}} → input.output.id（深层字段访问）
    expect(rhai).toContain('SELECT * FROM t WHERE id = "' + ' + input.output.id.to_string()')
    expect(rhai).toContain('数据库文件：C:\\\\data\\\\app.sqlite')
    expect(rhai).toContain('kind: "database"')
    // knowledge
    expect(rhai).toContain('node k knowledge')
    expect(rhai).toContain('用 knowledge_search 工具在本地知识库「docs」全文检索：重试 OR 超时')
    expect(rhai).toContain('最多返回 3 条命中片段')
    expect(rhai).toContain('kind: "knowledge"')
    expect(rhai).toContain('capability_mode: "execute"')
  })

  it('标识符冲突/保留字编译期报错（a-b 与 a_b 撞名、id=input 撞保留字）', () => {
    const base: FlowDraft = {
      id: 'collision-flow',
      name: '冲突检测',
      description: '验证',
      version: '1',
      input_schema: { type: 'object' },
      output_schema: { type: 'object' },
      nodes: [
        { id: 's', type: 'start', params: { label: '起点' } },
        { id: 'e', type: 'end', params: {} },
      ],
      edges: [{ from: 's', to: 'e' }],
    }
    // a-b 与 a_b 规范化后都变 a_b → 报错
    const dup: FlowDraft = {
      ...base,
      nodes: [
        { id: 's', type: 'start', params: { label: '起点' } },
        { id: 'a-b', type: 'agent', params: { prompt: 'x' } },
        { id: 'a_b', type: 'agent', params: { prompt: 'y' } },
        { id: 'e', type: 'end', params: {} },
      ],
      edges: [
        { from: 's', to: 'a-b' },
        { from: 'a-b', to: 'a_b' },
        { from: 'a_b', to: 'e' },
      ],
    }
    expect(() => compileToRhai(dup)).toThrow(/变量名冲突/)
    // id 撞保留字 input → 报错
    const reserved: FlowDraft = {
      ...base,
      nodes: [
        { id: 's', type: 'start', params: { label: '起点' } },
        { id: 'input', type: 'agent', params: { prompt: 'x' } },
        { id: 'e', type: 'end', params: {} },
      ],
      edges: [
        { from: 's', to: 'input' },
        { from: 'input', to: 'e' },
      ],
    }
    expect(() => compileToRhai(reserved)).toThrow(/保留变量/)
  })

  it('正确编译基于 prev.output 的多路条件分支路由 (N-Way Routing)', () => {
    const draft: FlowDraft = {
      id: 'multi-branch-flow',
      name: '多路分支流程',
      description: '基于 Agent output 进行 N 路分流',
      version: '1',
      input_schema: { type: 'object' },
      output_schema: { type: 'object' },
      nodes: [
        { id: 's', type: 'start', params: { label: '起点' } },
        { id: 'evaluator', type: 'agent', params: { label: '评审员', prompt: '评估代码' } },
        { id: 'b', type: 'branch', params: { label: '多路分流' } },
        { id: 'pass', type: 'agent', params: { label: '直接发布', prompt: '发布' } },
        { id: 'review', type: 'agent', params: { label: '人工复审', prompt: '复审' } },
        { id: 'reject', type: 'agent', params: { label: '打回修改', prompt: '打回' } },
        { id: 'e', type: 'end', params: {} },
      ],
      edges: [
        { from: 's', to: 'evaluator' },
        { from: 'evaluator', to: 'b' },
        { from: 'b', to: 'pass', label: '通过' },
        { from: 'b', to: 'review', label: '待复审' },
        { from: 'b', to: 'reject', label: '拒绝' },
        { from: 'pass', to: 'e' },
        { from: 'review', to: 'e' },
        { from: 'reject', to: 'e' },
      ],
    }
    const rhai = compileToRhai(draft)
    expect(rhai).toContain('if (')
    expect(rhai).toContain('.output.branch == "通过"')
    expect(rhai).toContain('.output.contains("通过")')
    expect(rhai).toContain('} else if (')
    expect(rhai).toContain('.output.branch == "待复审"')
    expect(rhai).toContain('.output.branch == "拒绝"')
    expect(rhai).toContain('complete(')
  })
})
