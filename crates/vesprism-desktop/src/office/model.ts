/**
 * 办公桌核心数据模型与场景定义。
 * 支持交付级 AI 办公 Agent：材料夹关联 → 多步规划推理 → 工具调用追踪 → 多模态富产物交付与交互改稿。
 */

import type { OfficeFormat } from './catalog'

export type OfficeKind = 'doc' | 'pptx' | 'xlsx' | 'pdf' | 'report'

export type OfficeStarter = {
  id: string
  title: string
  hint: string
  category: 'doc' | 'data' | 'slides' | 'legal' | 'meeting'
  kind: OfficeKind
  defaultPrompt: string
  tags: string[]
}

export const OFFICE_STARTERS: readonly OfficeStarter[] = [
  {
    id: 'weekly',
    title: '写周报',
    hint: '根据本周销售底稿和纪要，结构化提炼进展、风险与下周计划',
    category: 'doc',
    kind: 'doc',
    defaultPrompt: '根据材料夹中的销售周报底稿和会议纪要，出一份结构化、可直接汇报的第 12 周工作周报。',
    tags: ['公文周报', '进展提炼', '风险对策'],
  },
  {
    id: 'deck',
    title: '做汇报 PPT',
    hint: '把业务进展与要点梳理成 8 页管理层汇报幻灯片，含演讲备注',
    category: 'slides',
    kind: 'pptx',
    defaultPrompt: '把华东区域业务进展与竞品对策拆解成 8 页管理层汇报 PPT 提纲与幻灯片内容。',
    tags: ['管理层汇报', '幻灯片', '结构化提纲'],
  },
  {
    id: 'contract',
    title: '合同法务审查',
    hint: '抽取履约义务、付款节点与违约条款，标出高/中风险项与对策',
    category: 'legal',
    kind: 'doc',
    defaultPrompt: '审查材料夹中的续约合同草案，抽取核心义务、关键日期与金额，并列出风险等级与修改建议。',
    tags: ['条款抽取', '合规审查', '风险评级'],
  },
  {
    id: 'excel_analysis',
    title: '竞品价格对账分析',
    hint: '对竞品报价表进行多维交叉比对，计算毛利率影响并输出分析表',
    category: 'data',
    kind: 'xlsx',
    defaultPrompt: '比对竞品最新价格表与我方华东基准价，测算毛利率波动，生成交叉对比表格与分析结论。',
    tags: ['多表对账', '毛利测算', '数据洞察'],
  },
  {
    id: 'meeting_minutes',
    title: '会议纪要与待办跟进',
    hint: '提炼录音与讨论纪要的核心决议，提取 Action Items 责任人与截止时间',
    category: 'meeting',
    kind: 'doc',
    defaultPrompt: '整理周四华东业务复盘会纪要，提炼核心决议，生成含责任人与 DDL 的待办清单。',
    tags: ['纪要提炼', '待办派发', 'Action Items'],
  },
  {
    id: 'market_research',
    title: '行业与竞品调研矩阵',
    hint: '聚合多源信息，输出竞品功能对比、SWOT 分析与市场策略建议',
    category: 'data',
    kind: 'xlsx',
    defaultPrompt: '调研国内主流 AI 办公 Agent 解决方案，梳理功能矩阵与差异化优势，汇总成对照表。',
    tags: ['竞品矩阵', 'SWOT分析', '策略建议'],
  },
  {
    id: 'doc_polish',
    title: '公文规范审校与排版',
    hint: '按企事业单位标准公文规范审校底稿，纠正错别字、语病并规范格式',
    category: 'doc',
    kind: 'doc',
    defaultPrompt: '对华东区域战略合作推进报告进行公文规范审校，优化行文措辞与层次结构。',
    tags: ['公文审校', '格式规范', '润色优化'],
  },
]

export type MaterialFile = {
  id: string
  name: string
  size: string
  kind: 'md' | 'txt' | 'xlsx' | 'docx' | 'pdf'
  description: string
  updatedAt: string
}

export type DemoFolder = {
  id: string
  name: string
  description: string
  files: MaterialFile[]
}

export const DEMO_FOLDERS: readonly DemoFolder[] = [
  {
    id: 'week',
    name: '本周工作材料',
    description: '包含本周销售底稿、客户拜访纪要与竞品价格',
    files: [
      { id: 'f1', name: '销售周报底稿.md', size: '14.2 KB', kind: 'md', description: '华东区域 3 家核心客户复盘笔记', updatedAt: '周五 18:20' },
      { id: 'f2', name: '客户纪要-周四.txt', size: '8.6 KB', kind: 'txt', description: '周四线上复盘会议录音文字整理稿', updatedAt: '周四 16:45' },
      { id: 'f3', name: '竞品价格表.xlsx', size: '42.1 KB', kind: 'xlsx', description: '竞品最新 Q3 阶梯报价与入口价格矩阵', updatedAt: '周三 11:30' },
      { id: 'f4', name: '采购合同初稿-续约.docx', size: '28.5 KB', kind: 'docx', description: '华东客户意向续约服务框架协议草案', updatedAt: '周二 14:10' },
      { id: 'f5', name: '季度经营快报.pdf', size: '86.4 KB', kind: 'pdf', description: '公司 Q2 经营数据与毛利考核指标', updatedAt: '周一 09:00' },
    ],
  },
  {
    id: 'project_alpha',
    name: 'AI 办公专题调研',
    description: '国内外部署方案、用户画像与功能拆解',
    files: [
      { id: 'pa1', name: '国内AI办公调研汇总.md', size: '22.8 KB', kind: 'md', description: '飞书、钉钉、WPS AI 特性对比', updatedAt: '前天 15:30' },
      { id: 'pa2', name: '用户反馈与需求清单.xlsx', size: '36.0 KB', kind: 'xlsx', description: '50 位企业管理员深度访谈记录', updatedAt: '前天 11:00' },
    ],
  },
]

export const DEMO_FOLDER = {
  name: DEMO_FOLDERS[0].name,
  files: DEMO_FOLDERS[0].files.map((f) => f.name) as readonly string[],
}

export type PlanStep = {
  id: string
  label: string
  toolName?: string
  detail?: string
}

const PLANS: Record<string, PlanStep[]> = {
  weekly: [
    { id: 'read', label: '读取材料夹里的销售底稿、会议纪要与考核指标', toolName: 'fs_read_material', detail: '已读取 3 份上下文文件，定位 4 处关键进展与 2 处风险' },
    { id: 'outline', label: '结构化梳理：本周进展、风险归因、下周规划', toolName: 'reasoning_outline', detail: '按「结论先行-数据支撑-行动跟进」原则提炼大纲' },
    { id: 'draft', label: '撰写周报正文并补充数据指标支持', toolName: 'doc_synthesis', detail: '撰写完成，整合华东 3 家客户续约进展与价格波动预警' },
    { id: 'file', label: '封装为预览文本', toolName: 'office_doc_export', detail: '已生成可阅读的预览文本' },
  ],
  deck: [
    { id: 'read', label: '解析周报底稿与竞品价格矩阵', toolName: 'fs_read_material', detail: '提取华东业务数据、客户名单与价格变动指标' },
    { id: 'outline', label: '规划 8 页管理层汇报提纲与演讲脉络', toolName: 'deck_structurer', detail: '封面 → 结论 → 数据洞察 → 客户复盘 → 风险 → 对策 → 下一步 → 附录' },
    { id: 'slides', label: '生成逐页幻灯片内容、核心图表卡片与演讲备注', toolName: 'deck_builder', detail: '已完成 8 页幻灯片布局与关键指标提炼' },
    { id: 'file', label: '封装为预览文本', toolName: 'office_pptx_export', detail: '已就绪，可在画板翻页预览' },
  ],
  contract: [
    { id: 'read', label: '扫描续约采购合同草案及往来纪要', toolName: 'contract_parser', detail: '解析 14 章节条款，定位权责、付款、保密及违约部分' },
    { id: 'extract', label: '抽取履约义务、关键日期、结算金额与排他条款', toolName: 'entity_extractor', detail: '抽取关键节点 4 项、支付条款 2 项、交付要求 3 项' },
    { id: 'risk_audit', label: '对照法务合规库执行风险评估与分级标定', toolName: 'legal_risk_auditor', detail: '识别出 1 处高风险（毛利下限未锁）、2 处中风险（交付期限过紧）' },
    { id: 'file', label: '封装为预览文本', toolName: 'office_doc_export', detail: '已生成审查意见预览' },
  ],
  excel_analysis: [
    { id: 'read', label: '加载竞品价格表与我方基准价格矩阵', toolName: 'xlsx_loader', detail: '读取 5 个品类、32 项规格的基准价与竞品调价数据' },
    { id: 'diff', label: '多维交叉比对计算价差与毛利率冲击', toolName: 'data_cruncher', detail: '竞品入口价下调 12.5%，测算综合毛利承压约 3.8 个百分点' },
    { id: 'kpi', label: '生成核心指标看板与品类异动归因', toolName: 'metrics_aggregator', detail: '完成品类价格弹性分析与推荐对策测算' },
    { id: 'file', label: '封装为预览文本', toolName: 'office_xlsx_export', detail: '已生成对账表格预览' },
  ],
  meeting_minutes: [
    { id: 'read', label: '解析会议录音文字稿与与会人发言', toolName: 'audio_transcript_parser', detail: '识别 4 位与会人员、45 分钟讨论内容与 6 项核心议题' },
    { id: 'summary', label: '提炼会议核心决议与重要共识', toolName: 'meeting_summarizer', detail: '整理出商务策略、产品迭代、交付排期 3 项核心决议' },
    { id: 'actions', label: '抽取 Action Items 待办清单（负责人/DDL/产出物）', toolName: 'action_item_extractor', detail: '提取 4 项具体待办事项并标定跟踪责任人与截止时间' },
    { id: 'file', label: '封装为预览文本', toolName: 'office_doc_export', detail: '已生成纪要与待办预览' },
  ],
  market_research: [
    { id: 'read', label: '汇总市场调研文档、竞品动态与用户反馈', toolName: 'research_crawler', detail: '整合 3 家主要竞品产品矩阵、定价策略与用户口碑' },
    { id: 'matrix', label: '构建功能对比横评矩阵与 SWOT 分析', toolName: 'matrix_synthesizer', detail: '梳理 18 项关键特性对比，标定核心壁垒与补齐方向' },
    { id: 'strategy', label: '产出产品定位建议与商业化落地策略', toolName: 'strategy_advisor', detail: '提炼 3 条关键产品差异化建议' },
    { id: 'file', label: '封装为预览文本', toolName: 'office_xlsx_export', detail: '已生成对照表预览' },
  ],
  doc_polish: [
    { id: 'read', label: '读取公文底稿与公文规范规则集', toolName: 'doc_reader', detail: '解析文档层级、段落标题、编号与行文格式' },
    { id: 'audit', label: '审校错别字、语病、称谓及格式规范', toolName: 'grammar_and_style_checker', detail: '发现并纠正 5 处标点用词规范、3 处层级编号错误' },
    { id: 'polish', label: '优化公文严谨性，统一用语与排版格式', toolName: 'style_polisher', detail: '已按党政机关公文格式规范调整标题、正文与签发结构' },
    { id: 'file', label: '封装为预览文本', toolName: 'office_doc_export', detail: '已生成审校预览' },
  ],
}

const CUSTOM_PLAN: PlanStep[] = [
  { id: 'read', label: '读取材料夹关联文件与知识库规范', toolName: 'fs_read_material', detail: '解析相关上下文材料' },
  { id: 'plan', label: '拆解任务目标并制定交付大纲', toolName: 'reasoning_planner', detail: '确定交付结构与论证逻辑' },
  { id: 'draft', label: '调用 Agent 技能起草正文与结构化内容', toolName: 'agent_executor', detail: '多轮生成与数据填充' },
  { id: 'file', label: '封装为预览文本', toolName: 'artifact_packer', detail: '预览已就绪' },
]

export type SlideCard = {
  index: number
  title: string
  subtitle?: string
  points: string[]
  notes?: string
}

export type TableRowData = Record<string, string | number>

export type RiskItem = {
  id: string
  level: 'high' | 'medium' | 'low'
  clause: string
  risk: string
  advice: string
}

export type ActionItem = {
  id: string
  task: string
  owner: string
  deadline: string
  status: 'pending' | 'in_progress' | 'done'
}

export type DemoFile = {
  name: string
  title: string
  kind: OfficeKind
  summary: string
  preview: string
  wordCount?: number
  slides?: SlideCard[]
  tableColumns?: { key: string; label: string; width?: string }[]
  tableRows?: TableRowData[]
  riskItems?: RiskItem[]
  actionItems?: ActionItem[]
}

const FILES: Record<string, DemoFile> = {
  weekly: {
    name: '第12周工作周报-华东区域.md',
    title: '华东区域销售与业务复盘周报（第 12 周）',
    kind: 'doc',
    summary: '总结华东 3 家重点客户复盘进展，识别竞品价格战风险并制定周一响应对策。',
    wordCount: 1420,
    preview: `# 华东区域销售与业务复盘周报（第 12 周）

**汇报周期**：2026 年 3 月 16 日 - 3 月 20 日  
**汇报人**：华东大区负责人  
**主送**：业务委员会、销售运营部  

---

### 一、 本周核心进展与成果
1. **重点客户复盘与意向锁定**：
   - 完成华东区域 **3 家千万级标杆客户**（上海电气、苏州制造、杭州云享）现场业务复盘。
   - 其中 **2 家客户已正式确认续约意向**，续约合同金额预计达 480 万元；意向协议节点推进顺利。
2. **交付与回款跟进**：
   - Q1 存量项目完成阶段性验收，回款到账率达 94.2%，现金流状况健康。
   - 客户对 Q1 交付团队响应速度评价达 4.9 分（满分 5 分）。

---

### 二、 风险预警与归因分析
> ⚠️ **竞品价格下调冲击毛利**：  
> 竞品在华东市场率先将标准版入口价下调 **12.5%**，并在部分投标中采取“首年低价绑定”策略。若我方直接跟进价格战，将直接拉低区域综合毛利约 **3.8 个百分点**；销售一线反馈客户产生观望情绪。

---

### 三、 应对策略与资源需求
1. **差异化价值包对抗低价**：
   - 不打纯价格战，打包“专属交付服务 + 智能运维插件”，维持原签约单价。
   - 针对高敏感度客户，推出首年阶梯结算机制。
2. **需要总部支持**：
   - 协调法务与售前团队，在 **下周三前** 完成续约合同特别条款审批。

---

### 四、 下周重点工作计划 (Next Week)
- **周一 09:00**：向管理层提交《华东竞品价格应对与服务打包一页纸》。
- **周二至周三**：推进 2 家续约客户的正式合同节点签署。
- **周四**：召开华东代理商季度策略同步会。
- **周五**：汇总 Q1 最终销售指标归档。`,
    actionItems: [
      { id: 'a1', task: '提交《华东竞品价格应对一页纸》', owner: '张明 (华东总监)', deadline: '下周一 09:00', status: 'pending' },
      { id: 'a2', task: '完成 2 家客户续约合同条款会审', owner: '李华 (法务/售前)', deadline: '下周三 17:00', status: 'pending' },
      { id: 'a3', task: '组织华东代理商策略会', owner: '王磊 (渠道经理)', deadline: '下周四 14:00', status: 'pending' },
    ],
  },
  deck: {
    name: '华东区域业务汇报与策略对策.md',
    title: '华东区域业务进展与策略汇报',
    kind: 'pptx',
    summary: '8 页结构化幻灯片，包含经营复盘、竞品动态、客户画像与落地排期。',
    preview: '8 页管理层汇报幻灯片，包含演讲提纲与每页卡片。',
    slides: [
      {
        index: 1,
        title: '华东区域业务进展与策略汇报',
        subtitle: '2026 第 12 周经营复盘与竞品应对方案',
        points: ['汇报部门：华东战略大区', '核心主题：两家续约意向锁定 · 应对竞品降价冲击 · 稳毛利增值打法', '密级：内部呈阅'],
        notes: '开场致辞：强调本周核心成果是锁定了两家关键客户，同时重点汇报针对竞品降价的系统性对策。',
      },
      {
        index: 2,
        title: '执行摘要 · 稳中有进，挑战明确',
        subtitle: '核心指标与经营结论一览',
        points: [
          '经营成果：华东 3 家重点标杆客户完成复盘，2 家确认续约意向。',
          '预期规模：意向合同总额 480 万，存量项目回款率 94.2%。',
          '核心挑战：竞品下调入口价 12.5%，客户采购决策周期延长。',
          '应对破局：以「增值服务包」抵御纯价格战，守住 45% 毛利红线。',
        ],
        notes: '本页用 1 分钟向领导传递最核心数字与决策点，不拖泥带水。',
      },
      {
        index: 3,
        title: '客户复盘 · 3 家核心客户跟进进展',
        subtitle: '续约意向与业务诉求分析',
        points: [
          '上海电气（重点）：续约意向已确认，关注定制化数据接口与 SLA。',
          '苏州制造（重点）：已确认二期扩容，要求下周三前确定交付时间表。',
          '杭州云享（推进中）：对价格变动较敏感，正在通过增值方案沟通。',
        ],
        notes: '重点突出上海电气和苏州制造的落地确定性，稳固大盘。',
      },
      {
        index: 4,
        title: '市场洞察 · 竞品价格与策略动向',
        subtitle: '竞品阶梯价格 vs 我方方案对比',
        points: [
          '竞品动作：推出标准版低价入口策略，降幅达 12.5%。',
          '潜在风险：盲目跟进降价将导致毛利率下降 3.8 个百分点。',
          '客户反馈：客户更看重稳定性与售后支持，低价竞品故障率偏高。',
        ],
        notes: '用数据论证不跟进价格战的合理性，突出我方产品稳定性与服务优势。',
      },
      {
        index: 5,
        title: '竞争策略 · 差异化价值包组合拳',
        subtitle: '从卖产品转变为「产品 + 专属保障」',
        points: [
          '服务增值：赠送专属架构师巡检与 7×24 小时应急通道。',
          '灵活账期：针对续约客户提供首年分阶段支付模式。',
          '生态联动：结合企业微信/飞书连接器，降低客户迁移成本。',
        ],
        notes: '详细解释增值方案如何帮助客户算清总体拥有成本 (TCO)。',
      },
      {
        index: 6,
        title: '财务测算 · 收益与毛利敏感性分析',
        subtitle: '方案实施后的收益预期',
        points: [
          '预计签约额：华东 Q1 冲刺目标 600 万元，预计完成率 108%。',
          '毛利保持率：通过增值组合，综合毛利率稳定在 46.2%。',
          '投入产出比：增值服务边际成本仅 3.5 万元，ROI 超过 1:12。',
        ],
        notes: '用财务数据给管理层吃定心丸，证明策略的可行性与高回报。',
      },
      {
        index: 7,
        title: '落地排期 · 下一步里程碑 (Roadmap)',
        subtitle: '周度重点事项与责任分工',
        points: [
          '周一：向总部管理层呈报对策方案一页纸。',
          '周三：完成 2 家客户正式协议法务会签。',
          '周四：召开区域渠道协同会议，统一步调。',
          '周五：锁定一期款项到账。',
        ],
        notes: '清晰明确的时间表，责任到人。',
      },
      {
        index: 8,
        title: '附录与支持 · 资源协调与附件',
        subtitle: '需要总部协调支持的事项',
        points: [
          '法务支持：特批合同定制条款绿色通道。',
          '技术专家：指派资深解决方案架构师参与周三客户技术答疑。',
          '附件链接：本周材料夹包含《价格表》、《客户会议纪要原文》可查阅。',
        ],
        notes: '请求明确的资源支持，便于各部门即刻协同。',
      },
    ],
  },
  contract: {
    name: '续约服务合同法务审查意见书.md',
    title: '续约框架协议法务审查与风险评估意见',
    kind: 'doc',
    summary: '抽取关键义务与履约节点，识别 1 处高风险与 2 处中风险，给出修改条款建议。',
    wordCount: 1180,
    preview: `# 续约框架协议法务审查与风险评估意见书

**审查对象**：华东区域某核心客户续约框架协议（初稿）  
**审查基准**：企业标准合同规范、合规红线及商业交付准则  
**综合审查结论**：**原则同意，需前置修改高风险条款后方可盖章**  

---

### 一、 核心商务与权责条款抽取
1. **签约主体与标的**：甲方（客户）与乙方（我方），标的为数字化工作台续约与扩容技术服务。
2. **结算金额与方式**：年度服务费总额 480 万元，分三期按 40%-30%-30% 支付。
3. **交付期限**：合同签订后 10 个工作日内完成环境部署与联调。
4. **服务级别协议 (SLA)**：系统可用性不低于 99.9%，故障响应时间 ≤ 15 分钟。

---

### 二、 风险排查与修改建议清单

| 风险等级 | 涉及条款 | 风险简述 | 修改建议与对策 |
| :--- | :--- | :--- | :--- |
| 🔴 **高风险** | 第 4.2 条 价格保护 | 约定若我方对任何第三方降价，需同比例回溯退款（无毛利下限约束） | **坚决删除回溯条款**，修改为“在合同期内享受当季优惠价格联动”，设定毛利保护底线 |
| 🟡 **中风险** | 第 7.1 条 违约赔偿 | 约定单次延迟交付按合同全额每日 0.5% 计收违约金，无上限限制 | **增加违约金上限**：“累计违约赔偿总额不得超过该阶段合同款项的 10%” |
| 🟡 **中风险** | 第 11.3 条 知识产权 | 条款对交付衍生物产权归属表述模糊，存在共有权争议隐患 | 明确约定：“我方既有核心技术及通用组件知识产权归我方所有，客户仅享有使用权” |
| 🟢 **低风险** | 第 13.1 条 争议管辖 | 约定争议提交甲方所在地法院管辖 | 可接受，建议优先争取为“原告所在地”或“北京仲裁委员会仲裁” |

---

### 三、 法务跟进建议
- 请业务部门责成法务顾问按上述建议出具红线修改批注版（Redline Version）。
- 锁定下周三为修改版确认截止日。`,
    riskItems: [
      {
        id: 'r1',
        level: 'high',
        clause: '第 4.2 条 价格保护与退款',
        risk: '要求同比例回溯退款且无毛利底线，一旦有特价单将导致巨额亏损。',
        advice: '坚决删除同比例回溯退款条款，改为限期优惠，并锁定最低毛利保障。',
      },
      {
        id: 'r2',
        level: 'medium',
        clause: '第 7.1 条 违约金计算',
        risk: '违约金每日 0.5% 且无封顶，极易因客观不可抗力导致过重负债。',
        advice: '增加赔偿上限条款：“累计总额不得超过相应阶段金额的 10%”。',
      },
      {
        id: 'r3',
        level: 'medium',
        clause: '第 11.3 条 知识产权归属',
        risk: '衍生代码与底座组件产权界定模糊，存在核心资产外流争议风险。',
        advice: '清晰拆分“客户业务数据”与“我方软件底座知识产权”，保留底座所有权。',
      },
    ],
  },
  excel_analysis: {
    name: '竞品价格对比与毛利测算分析.md',
    title: '华东区域竞品价格对比与毛利敏感性测算表',
    kind: 'xlsx',
    summary: '多维交叉分析 5 个主流版本价格差异、降幅及对我方毛利率的影响测算。',
    preview: '多维表格数据分析：包含 5 个版本基准价、竞品价、价差、毛利率变动测算。',
    tableColumns: [
      { key: 'category', label: '产品版本/模块', width: '140px' },
      { key: 'myPrice', label: '我方基准单价 (万元)', width: '150px' },
      { key: 'rivalPrice', label: '竞品最新报价 (万元)', width: '150px' },
      { key: 'gap', label: '价差率', width: '110px' },
      { key: 'myMargin', label: '我方当前毛利率', width: '130px' },
      { key: 'impactMargin', label: '若跟进降价后毛利', width: '140px' },
      { key: 'strategy', label: '建议策略', width: '160px' },
    ],
    tableRows: [
      { category: '基础协同版 (100人)', myPrice: 12.8, rivalPrice: 11.2, gap: '-12.5%', myMargin: '52.0%', impactMargin: '45.1%', strategy: '保持原价 + 赠送培训' },
      { category: '专业智能版 (500人)', myPrice: 38.0, rivalPrice: 34.5, gap: '-9.2%', myMargin: '48.5%', impactMargin: '43.2%', strategy: '打包专属运维通道' },
      { category: '企业定制版 (1000人)', myPrice: 85.0, rivalPrice: 82.0, gap: '-3.5%', myMargin: '45.0%', impactMargin: '42.9%', strategy: '主打高可用与私有化' },
      { category: 'AI 智能体插件包', myPrice: 15.0, rivalPrice: 16.5, gap: '+10.0%', myMargin: '65.0%', impactMargin: '65.0%', strategy: '我方具备优势，作为溢价点' },
      { category: '专属私有化集群', myPrice: 120.0, rivalPrice: 118.0, gap: '-1.7%', myMargin: '40.0%', impactMargin: '38.9%', strategy: '强调军工级安全与审计' },
    ],
  },
  meeting_minutes: {
    name: '周四华东业务复盘会纪要与待办.md',
    title: '华东区域 Q1 业务复盘与竞品应对会议纪要',
    kind: 'doc',
    summary: '4 位核心参会人 45 分钟讨论纪要，提炼 3 项决议并生成 4 项待办。',
    wordCount: 960,
    preview: `# 华东区域 Q1 业务复盘与竞品应对会议纪要

**会议时间**：2026 年 3 月 19 日 14:00 - 15:30  
**会议形式**：华东大区线上会议室  
**参会人员**：张明（大区总）、李华（售前支持）、王磊（渠道总监）、赵雪（客户成功）  
**主持人**：张明  
**纪要记录**：AI 办公助理  

---

### 一、 会议核心共识与决议
1. **统一商务口径**：面对竞品降价，全体销售与渠道严禁私自降价，统一采用“产品+专属保障包”方案。
2. **重点攻坚客户**：优先确保上海电气与苏州制造在下周三前签署正式续约合同。
3. **渠道激励与培训**：本周四由王磊组织华东重点代理商培训，讲透价值包与竞品软肋。

---

### 二、 待办事项跟进清单 (Action Items)`,
    actionItems: [
      { id: 'm1', task: '起草《华东竞品应对一页纸》方案呈报总部', owner: '张明', deadline: '周一 09:00', status: 'pending' },
      { id: 'm2', task: '配合法务修改续约合同中高风险条款', owner: '李华', deadline: '周二 17:00', status: 'in_progress' },
      { id: 'm3', task: '召开华东核心代理商价值赋能线上会', owner: '王磊', deadline: '周四 14:00', status: 'pending' },
      { id: 'm4', task: '完成存量客户满意度调研与回款跟进', owner: '赵雪', deadline: '周五 18:00', status: 'in_progress' },
    ],
  },
  market_research: {
    name: '国内AI办公Agent竞品对照矩阵.md',
    title: '国内主流 AI 办公智能体平台横评与产品策略分析',
    kind: 'xlsx',
    summary: '横向对比飞书、钉钉、WPS AI 与 Vesprism 办公桌在协同、文档、数据与执行层面的差异。',
    preview: '多维对比表格：覆盖 4 大主流产品、6 项核心能力维度与商业化定位。',
    tableColumns: [
      { key: 'platform', label: '办公智能体平台', width: '150px' },
      { key: 'coreStrength', label: '核心强项', width: '180px' },
      { key: 'docAbility', label: '文档/PPT生成能力', width: '160px' },
      { key: 'sheetAbility', label: '多维表格/数据分析', width: '160px' },
      { key: 'agentOS', label: '工作流编排与执行', width: '170px' },
      { key: 'security', label: '本地沙箱与权限管控', width: '160px' },
    ],
    tableRows: [
      { platform: '飞书 (豆包工作伙伴)', coreStrength: '团队工作流闭环、主动跟进', docAbility: '飞书文档智能续写/总结', docAbility_note: '基于多维表格', sheetAbility: '多维表格灵感应用', agentOS: '智能伙伴 Workflow 编排', security: '云端企业级权限体系' },
      { platform: '钉钉 (Agent OS / 悟空)', coreStrength: '系统级操控、软硬一体化', docAbility: '钉钉文档/纪要汇总', sheetAbility: '智能分析表与看板巡检', agentOS: '统一构建与运行标准', security: '本地部署与安全隔离' },
      { platform: 'WPS AI (WPS 365)', coreStrength: '文档存量资产沉淀、格式兼容', docAbility: '长文档审校、PPT一键生成', sheetAbility: '多源异构数据清洗建模', agentOS: '多维表格灵感应用生成', security: '金山办公安全认证' },
      { platform: 'Vesprism 办公桌 (本地原生)', coreStrength: '本地优先、独立交付物画板、多模型', docAbility: '标准 Word/PPTX/PDF 导出', sheetAbility: '交互式数据透视与对账', agentOS: '多步自主推理规划与执行追踪', security: '本地文件沙箱与细粒度控制' },
    ],
  },
  doc_polish: {
    name: '华东区域战略推进报告-审校修订终稿.md',
    title: '华东区域战略合作推进报告（公文审校版）',
    kind: 'doc',
    summary: '纠正 5 处用词与标点、3 处层级编号错误，全面符合企事业单位公文规范标准。',
    wordCount: 1350,
    preview: `# 华东区域战略合作推进报告（审校定稿）

**发文字号**：华东发〔2026〕12号  
**签发人**：张明  
**密级**：内部公开  

---

### 一、 总体推进态势良好
华东大区全面落实集团第一季度经营方针，以“深耕重点客户、强化服务保障”为核心抓手。截至本周，区域已完成 3 家标杆企事业单位的阶段性合作复盘，战略合作框架推进有序。

### 二、 核心成果与数据指标
1. **签约进展**：已锁定两家大型集团续约意向，合作范围延伸至智慧办公与数据资产管理领域。
2. **服务质量**：第一季度客户综合满意度达到 98.6%，未发生重特大服务事故与合规违规事项。

### 三、 下步工作着力点
- 健全常态化风险预警机制，完善价格与服务联动矩阵。
- 加强合规条款前置会审，切实防范合同法律风险。`,
  },
}

const CUSTOM_FILE: DemoFile = {
  name: '交付预览.md',
  title: '办公任务交付文档',
  kind: 'doc',
  summary: '根据您的需求与材料夹内容生成的预览文本（演示）。',
  wordCount: 880,
  preview: `# 办公任务执行成果

### 一、 执行概述
已根据您的指令与所选材料夹完成深度分析与结构化提炼。

### 二、 核心结论
- 针对输入诉求完成了多步自主规划与信息比对。
- 生成了符合规范的结构化办公产物，支持一键复制与导出。

### 三、 建议与下一步
- 您可以在下方输入框中提出修改意见（例如：“增加数据对比”、“提炼为3条核心结论”）。`,
}

const CUSTOM_PPTX: DemoFile = {
  name: '交付预览.md',
  title: '幻灯片预览',
  kind: 'pptx',
  summary: '空幻灯片骨架，在改稿里写要点。',
  preview: '一页空幻灯片。',
  slides: [{ index: 1, title: '（空）', points: ['在下方改稿里写要点'] }],
}

const CUSTOM_XLSX: DemoFile = {
  name: '交付预览.md',
  title: '表格预览',
  kind: 'xlsx',
  summary: '空表骨架。',
  preview: '占位表格。',
  tableColumns: [
    { key: 'item', label: '项目' },
    { key: 'note', label: '说明' },
  ],
  tableRows: [{ item: '（空）', note: '在下方改稿里补充' }],
}

export function starterById(id: string): OfficeStarter | undefined {
  return OFFICE_STARTERS.find((s) => s.id === id)
}

export function planForTask(starterId: string | 'custom'): PlanStep[] {
  if (starterId === 'custom') return CUSTOM_PLAN.map((s) => ({ ...s }))
  return (PLANS[starterId] ?? CUSTOM_PLAN).map((s) => ({ ...s }))
}

function cloneFile(file: DemoFile): DemoFile {
  return {
    ...file,
    slides: file.slides?.map((s) => ({ ...s, points: [...s.points] })),
    tableColumns: file.tableColumns?.map((c) => ({ ...c })),
    tableRows: file.tableRows?.map((r) => ({ ...r })),
    riskItems: file.riskItems?.map((r) => ({ ...r })),
    actionItems: file.actionItems?.map((a) => ({ ...a })),
  }
}

export function deliverableForTask(
  starterId: string | 'custom',
  format: OfficeFormat = 'doc',
): DemoFile {
  if (starterId !== 'custom') {
    return cloneFile(FILES[starterId] ?? CUSTOM_FILE)
  }
  if (format === 'pptx') return cloneFile(CUSTOM_PPTX)
  if (format === 'xlsx') return cloneFile(CUSTOM_XLSX)
  return cloneFile(CUSTOM_FILE)
}

export function titleForCustom(text: string): string {
  const t = text.trim().replace(/\s+/g, ' ')
  if (!t) return '未命名任务'
  return t.length > 24 ? `${t.slice(0, 24)}…` : t
}

export type OfficeTaskStatus = 'idle' | 'running' | 'done'

export type OfficeTask = {
  id: string
  title: string
  starterId: string | 'custom'
  status: OfficeTaskStatus
  stepIndex: number
  plan: PlanStep[]
  file: DemoFile | null
  prompt: string
  createdAt: string
  folderId?: string
  toolLog?: string[]
  format: OfficeFormat
}

export function createOfficeTask(
  starterId: string | 'custom',
  prompt: string,
  id: string,
  folderId: string = 'week',
  format: OfficeFormat = 'doc',
): OfficeTask {
  const starter = starterId === 'custom' ? null : starterById(starterId)
  return {
    id,
    title: starter?.title ?? titleForCustom(prompt),
    starterId,
    status: 'idle',
    stepIndex: -1,
    plan: planForTask(starterId),
    file: null,
    prompt: prompt.trim() || starter?.defaultPrompt || starter?.hint || '',
    createdAt: new Date().toISOString(),
    folderId,
    toolLog: [],
    format: starterId === 'custom' ? format : starter?.kind === 'pptx' ? 'pptx' : starter?.kind === 'xlsx' ? 'xlsx' : 'doc',
  }
}

/** 每步推进。跑完最后一步后 status=done 并带上完整富产物。 */
export function advanceOfficeTask(task: OfficeTask): OfficeTask {
  if (task.status === 'done') return task
  const nextIndex = task.stepIndex + 1
  if (nextIndex >= task.plan.length) {
    const file = task.file ?? deliverableForTask(task.starterId, task.format)
    const logs = [...(task.toolLog ?? [])]
    logs.push(`[完成] 产物《${file.name}》已封装就绪，可供预览与导出`)
    return {
      ...task,
      status: 'done',
      stepIndex: task.plan.length,
      file,
      toolLog: logs,
    }
  }
  const currentStep = task.plan[nextIndex]
  const logs = [...(task.toolLog ?? [])]
  if (currentStep) {
    logs.push(`[执行] ${currentStep.label} (${currentStep.toolName ?? 'agent_loop'})`)
  }
  return {
    ...task,
    status: 'running',
    stepIndex: nextIndex,
    toolLog: logs,
  }
}

/** 对现有任务产物进行迭代微调 */
export function applyRefinement(task: OfficeTask, action: string): OfficeTask {
  if (!task.file) return task
  const newFile = { ...task.file }
  const logs = [...(task.toolLog ?? []), `[微调] 用户指令: "${action}"`]
  
  if (action.includes('精简') || action.includes('一页纸')) {
    newFile.summary = `【精简版】${newFile.summary}`
    newFile.preview = `> 📌 **精简摘要版**\n\n${newFile.preview.slice(0, 500)}...\n\n*(已按要求精简至核心结论)*`
  } else if (action.includes('英文') || action.includes('English')) {
    const stem = newFile.name.replace(/\.(md|docx|pptx|xlsx)$/i, '')
    newFile.name = `${stem}_EN.md`
    newFile.summary = `[English Version] ${newFile.summary}`
    newFile.preview = `## Executive Summary (English Translation)\n\n**Topic**: ${newFile.title}\n\n- Key Progress: 2 out of 3 key clients confirmed renewal intention.\n- Critical Risk: Competitor reduced entry price by 12.5%.\n- Next Actions: Submit action one-pager by Monday morning.`
  } else if (action.includes('待办') || action.includes('Action')) {
    logs.push('[微调] 提取并强化 Action Items 待办清单')
  }

  return {
    ...task,
    file: newFile,
    toolLog: logs,
  }
}
