/**
 * 办公工作台模块配置与数据字典。
 * 覆盖场景胶囊、技能库、Agent、企业知识库、自动化排程与连接器生态。
 */

export type OfficePanel =
  | 'home'
  | 'skills'
  | 'agents'
  | 'knowledge'
  | 'schedule'
  | 'connectors'
  | 'history'

export const OFFICE_NAV: readonly { id: OfficePanel; label: string; icon: string; badge?: string }[] = [
  { id: 'home', label: '新任务', icon: 'sparkles' },
  { id: 'skills', label: '技能', icon: 'bolt', badge: '8' },
  { id: 'agents', label: 'Agent', icon: 'users', badge: '6' },
  { id: 'knowledge', label: '知识库', icon: 'book', badge: '5' },
  { id: 'schedule', label: '排程', icon: 'clock', badge: '4' },
  { id: 'connectors', label: '连接器', icon: 'plug', badge: '6' },
  { id: 'history', label: '历史', icon: 'archive' },
]

export type OfficePermission = 'ask' | 'default' | 'full'
export type OfficeFormat = 'doc' | 'xlsx' | 'pptx'

export const OFFICE_PERMISSIONS: readonly { id: OfficePermission; label: string; desc: string }[] = [
  { id: 'ask', label: '写前确认', desc: '执行重要写入或修改前向您确认' },
  { id: 'default', label: '默许读取', desc: '自主读取材料，写盘需提示' },
  { id: 'full', label: '自主全开（演示）', desc: '演示不写盘' },
]

export const OFFICE_FORMATS: readonly { id: OfficeFormat; label: string; ext: string }[] = [
  { id: 'doc', label: '文稿预览', ext: '.md' },
  { id: 'pptx', label: '幻灯片预览', ext: '.md' },
  { id: 'xlsx', label: '表格预览', ext: '.md' },
]

export const OFFICE_FOLDERS: readonly { id: string; name: string; count: number }[] = [
  { id: 'week', name: '本周工作材料', count: 5 },
  { id: 'project_alpha', name: 'AI 办公专题调研', count: 2 },
  { id: 'none', name: '暂不关联材料', count: 0 },
]

export type OfficeCapsule = {
  id: string
  title: string
  category: '公文汇报' | '数据分析' | '法务合规' | '会务协同' | '智能调研'
  prompt: string
  starterId: string | 'custom'
  blocked?: boolean
  description: string
  targetFormat: OfficeFormat
}

export const OFFICE_CAPSULES: readonly OfficeCapsule[] = [
  {
    id: 'weekly',
    title: '写周报',
    category: '公文汇报',
    prompt: '根据材料夹中的销售周报底稿和会议纪要，出一份结构化、可直接汇报的第 12 周工作周报。',
    starterId: 'weekly',
    description: '自动提炼进展、识别竞品风险与下周计划',
    targetFormat: 'doc',
  },
  {
    id: 'deck',
    title: '做汇报 PPT',
    category: '公文汇报',
    prompt: '把华东区域业务进展与竞品对策拆解成 8 页管理层汇报 PPT 提纲与幻灯片内容。',
    starterId: 'deck',
    description: '8 页结构化幻灯片、演讲备注与图表卡片',
    targetFormat: 'pptx',
  },
  {
    id: 'contract',
    title: '合同法务审查',
    category: '法务合规',
    prompt: '审查材料夹中的续约合同草案，抽取核心义务、关键日期与金额，并列出风险等级与修改建议。',
    starterId: 'contract',
    description: '条款抽取、排他合规审查与修改意见书',
    targetFormat: 'doc',
  },
  {
    id: 'excel_analysis',
    title: '分析 Excel 价格表',
    category: '数据分析',
    prompt: '比对竞品最新价格表与我方华东基准价，测算毛利率波动，生成交叉对比表格与分析结论。',
    starterId: 'excel_analysis',
    description: '多维数据交叉对账、毛利测算与洞察',
    targetFormat: 'xlsx',
  },
  {
    id: 'meeting_minutes',
    title: '会议纪要与待办',
    category: '会务协同',
    prompt: '整理周四华东业务复盘会纪要，提炼核心决议，生成含责任人与 DDL 的待办清单。',
    starterId: 'meeting_minutes',
    description: '决议提炼、Action Items 派发与跟踪',
    targetFormat: 'doc',
  },
  {
    id: 'market_research',
    title: '竞品调研矩阵',
    category: '智能调研',
    prompt: '调研国内主流 AI 办公 Agent 解决方案，梳理功能矩阵与差异化优势，汇总成对照表。',
    starterId: 'market_research',
    description: 'SWOT 分析、功能横评对比与落地策略',
    targetFormat: 'xlsx',
  },
  {
    id: 'doc_polish',
    title: '公文规范审校',
    category: '公文汇报',
    prompt: '对华东区域战略合作推进报告进行公文规范审校，优化行文措辞与层次结构。',
    starterId: 'doc_polish',
    description: '纠正错别字与语病，规范党政企事业单位公文格式',
    targetFormat: 'doc',
  },
]

export type OfficeSkill = {
  id: string
  name: string
  category: '公文写作' | '数据表格' | '幻灯片' | '法务风控' | '综合自动化'
  prompt: string
  description: string
  inputs: string
  outputType: string
  format: OfficeFormat
}

export const OFFICE_SKILLS: readonly OfficeSkill[] = [
  {
    id: 'weekly_gen',
    name: '周报 / 月报结构化提炼',
    category: '公文写作',
    prompt: '按「本周进展、风险归因、资源支持、下周排期」结构提炼周报，生成可交 Word 文档。',
    description: '将碎片底稿与沟通记录提炼为标准化管理层汇报周报',
    inputs: '销售底稿、会议文字稿、项目日志',
    outputType: '文稿预览',
    format: 'doc',
  },
  {
    id: 'ppt_8slides',
    name: '管理层汇报 8 页 PPT',
    category: '幻灯片',
    prompt: '将材料中的业务事实拆解为 8 页幻灯片大纲，包含封面、数据洞察、对策与下一步。',
    description: '根据材料一键生成清晰演讲结构的 8 页 PPT 幻灯片',
    inputs: '业务报告、数据表格、要点笔记',
    outputType: '幻灯片预览',
    format: 'pptx',
  },
  {
    id: 'contract_audit',
    name: '合同合规与风险审校',
    category: '法务风控',
    prompt: '审查合同权责、违约金上限、知识产权归属与排他条款，标出高/中/低风险项并给出红线建议。',
    description: '对照企业法务合规库自动标定合同法律漏洞与修改建议',
    inputs: '合同扫描件/Word初稿',
    outputType: '文稿预览',
    format: 'doc',
  },
  {
    id: 'excel_diff',
    name: 'Excel 多表交叉对账与测算',
    category: '数据表格',
    prompt: '比对多个工作表的数据差异，计算关键指标波动率并汇总生成透视分析表。',
    description: '多源异构数据清洗、公式计算、价差与毛利测算',
    inputs: '多份 Excel / CSV 报表',
    outputType: '表格预览',
    format: 'xlsx',
  },
  {
    id: 'meeting_action',
    name: '会议纪要与 Action Items 提取',
    category: '公文写作',
    prompt: '提炼录音或文字纪要的核心共识，按责任人与截止时间输出标准化待办清单。',
    description: '自动提取参会人决议与后续可执行动作清单',
    inputs: '会议文字稿、讨论群聊记录',
    outputType: '待办预览',
    format: 'doc',
  },
  {
    id: 'market_matrix',
    name: '竞品横向横评与 SWOT 分析',
    category: '数据表格',
    prompt: '汇总竞品功能、定价、客群与优劣势，生成结构化横评矩阵表与策略建议。',
    description: '全景市场调研、竞品参数横向比对与战略破局点',
    inputs: '调研笔记、竞品公开资料',
    outputType: '表格预览',
    format: 'xlsx',
  },
  {
    id: 'doc_standards',
    name: '党政与企事业公文格式校验',
    category: '公文写作',
    prompt: '根据标准公文规范对底稿进行审校，纠正发文字号、标题层级、标点语病与排版规范。',
    description: '严格执行公文条例与行文规范，出具修订定稿',
    inputs: '申报材料、通知、请示底稿',
    outputType: '文稿预览',
    format: 'doc',
  },
  {
    id: 'auto_cron',
    name: '定时早报与数据巡检推送',
    category: '综合自动化',
    prompt: '在指定工作日时间自动汇集最新材料并输出一页纸简报，同步至飞书或本地目录。',
    description: '无人值守自动化办公 Agent 巡检与简报生成',
    inputs: '定时配置、数据源',
    outputType: '文稿预览',
    format: 'doc',
  },
]

export type OfficeAgent = {
  id: string
  name: string
  role: string
  avatar: string
  blurb: string
  style: string
  skills: string[]
}

export const OFFICE_AGENTS: readonly OfficeAgent[] = [
  {
    id: 'chief_secretary',
    name: '公文主笔 · 林秘书',
    role: '高级行政与公文',
    avatar: '林',
    blurb: '精通党政与大型企业公文规范，擅长行文严谨、层次分明的请示、通报、周报与总结。',
    style: '严谨务实、结构严密、用语规范、无多余修饰',
    skills: ['公文周报', '领导致辞', '制度章程', '会务纪要'],
  },
  {
    id: 'financial_analyst',
    name: '财务总监顾问 · 陈工',
    role: '资深财务与数据分析',
    avatar: '陈',
    blurb: '擅长多表对账、毛利敏感性测算、成本归因分析与财务报表透视。',
    style: '数据说话、逻辑自洽、注重风险边际与 ROI 测算',
    skills: ['多表对账', '毛利敏感性', '财务看板', '经营测算'],
  },
  {
    id: 'legal_advisor',
    name: '法务合规顾问 · 赵律师',
    role: '企业资深法务与合规',
    avatar: '赵',
    blurb: '深谙合同法、数据安全合规与知识产权法，精准把关商业合同中的风险漏洞与免责红线。',
    style: '底线思维、条款严密、标明风险等级与修改替代方案',
    skills: ['合同审查', '合规排查', '知识产权', '争议调解'],
  },
  {
    id: 'strategy_consultant',
    name: '战略研究员 · 顾总',
    role: '商业战略与行业分析',
    avatar: '顾',
    blurb: '擅长行业全景调研、竞品攻防矩阵搭建、商业模式拆解与管理层汇报 PPT 提纲梳理。',
    style: '宏观视野、结构化思维、金字塔原理、直击商业本质',
    skills: ['行业调研', '竞品矩阵', '管理层PPT', '商业规划'],
  },
  {
    id: 'hrbp_partner',
    name: '组织与人才 · 许敏',
    role: '资深 HRBP',
    avatar: '许',
    blurb: '专注 OKR 对齐、绩效面谈方案设计、岗位职责梳理与团队复盘跟进。',
    style: '以人为本、目标导向、落地清晰、激发团队协同',
    skills: ['绩效复盘', '岗位说明书', 'OKR梳理', '员工沟通'],
  },
  {
    id: 'ops_automator',
    name: '流程自动化 · 王工',
    role: '企业协同与流程',
    avatar: '王',
    blurb: '负责多系统连接器打通、飞书/钉钉多维表格联动与定时巡检任务编排。',
    style: '系统化、自动化闭环、高容错率',
    skills: ['定时巡检', '系统连接器', '审批流设计', '数据流转'],
  },
]

export type OfficeKnowledge = {
  id: string
  name: string
  category: '管理制度' | '业务口径' | '合规红线' | '行业标准'
  source: string
  updatedAt: string
  excerpt: string
  tags: string[]
}

export const OFFICE_KNOWLEDGE: readonly OfficeKnowledge[] = [
  {
    id: 'k1',
    name: '华东区域价格与折扣授权矩阵 (2026)',
    category: '业务口径',
    source: '营销委员会审批件',
    updatedAt: '2026-03-10',
    excerpt: '大区总监单笔折扣权限不得低于 8.5 折；低于 8.0 折需呈报商务委员会特批。毛利率低于 40% 的单据实行一票否决。',
    tags: ['价格红线', '折扣权限', '华东口径'],
  },
  {
    id: 'k2',
    name: '企业内部公文行文与周报撰写规范',
    category: '管理制度',
    source: '总裁办制度库',
    updatedAt: '2026-02-15',
    excerpt: '周报遵循「结论先行、数据支撑、归因分析、下周规划」四段式；严禁仅罗列工作流水账；重大风险需单列并提供 2 套应对预案。',
    tags: ['周报规范', '金字塔原理', '公文格式'],
  },
  {
    id: 'k3',
    name: '对外商业合同法务合规十条红线',
    category: '合规红线',
    source: '法务部合规指引',
    updatedAt: '2026-01-20',
    excerpt: '1. 严禁签署无上限的迟延交付违约金条款；2. 知识产权底座所有权归属我方；3. 严禁承诺回溯退款机制；4. 管辖法院优先约定我方所在地。',
    tags: ['合同红线', '违约责任', '知识产权'],
  },
  {
    id: 'k4',
    name: '核心客户简称与标准用语术语表',
    category: '业务口径',
    source: '客户成功部',
    updatedAt: '2026-03-01',
    excerpt: '上海电气集团股份有限公司统一简称为「上海电气」；苏州制造业转型升级示范基地简称为「苏州制造」；严禁使用口语化简称。',
    tags: ['客户名录', '术语规范', '简称对照'],
  },
  {
    id: 'k5',
    name: '企业差旅与财务报销标准细则',
    category: '管理制度',
    source: '财务部',
    updatedAt: '2026-02-01',
    excerpt: '华东一类城市住宿标准为 550 元/天；交通优先选择高铁二等座；报销发票必须附带行程单与业务事由说明。',
    tags: ['报销细则', '财务标准', '差旅规范'],
  },
]

export type OfficeSchedule = {
  id: string
  name: string
  when: string
  action: string
  target: string
  status: 'active' | 'paused'
  lastRun: string
}

export const OFFICE_SCHEDULES: readonly OfficeSchedule[] = [
  {
    id: 's1',
    name: '周一早报：华东业务对策一页纸',
    when: '每周一 09:00',
    action: '自动汇总周末材料，生成管理层周初简报（演示，不会发送）',
    target: '不会发送',
    status: 'active',
    lastRun: '从未运行（演示）',
  },
  {
    id: 's2',
    name: '周五复盘：客户反馈与回款汇总',
    when: '每周五 17:30',
    action: '汇总当周客户拜访纪要、回款到账明细与待办跟进进展',
    target: '不会发送',
    status: 'active',
    lastRun: '从未运行（演示）',
  },
  {
    id: 's3',
    name: '每日竞品价格异动巡检',
    when: '工作日 08:30',
    action: '检索抓取主流竞品公开报价与招投标动态，若降幅 >5% 则触发高危预警',
    target: '不会发送',
    status: 'active',
    lastRun: '从未运行（演示）',
  },
  {
    id: 's4',
    name: '合同到期前 30 天自动预警',
    when: '每日 10:00',
    action: '扫描法务合同库中剩余有效期 ≤30 天的存量客户，自动生成续约沟通底稿',
    target: '不会发送',
    status: 'active',
    lastRun: '从未运行（演示）',
  },
]

export type OfficeConnector = {
  id: string
  name: string
  category: '协同平台' | '文档办公' | '本地系统' | '外部数据'
  icon: string
  status: 'connected' | 'unconnected' | 'auth_needed'
  description: string
  features: string[]
}

export const OFFICE_CONNECTORS: readonly OfficeConnector[] = [
  {
    id: 'local_sandbox',
    name: '演示材料夹',
    category: '本地系统',
    icon: '夹',
    status: 'unconnected',
    description: '内存名单，不写盘，不接引擎。',
    features: ['演示名单', '不写盘'],
  },
  {
    id: 'feishu',
    name: '飞书 (Feishu / Lark)',
    category: '协同平台',
    icon: 'FS',
    status: 'unconnected',
    description: '演示未接。不读云文档，不发群消息。',
    features: ['未接', '演示'],
  },
  {
    id: 'dingtalk',
    name: '钉钉 (DingTalk)',
    category: '协同平台',
    icon: 'DT',
    status: 'unconnected',
    description: '演示未接。',
    features: ['未接', '演示'],
  },
  {
    id: 'wecom',
    name: '企业微信 (WeCom)',
    category: '协同平台',
    icon: 'WX',
    status: 'unconnected',
    description: '演示未接。',
    features: ['未接', '演示'],
  },
  {
    id: 'wps365',
    name: 'WPS 365 办公套件',
    category: '文档办公',
    icon: 'WP',
    status: 'unconnected',
    description: '演示未接。不生成真实 Office 文件。',
    features: ['未接', '演示'],
  },
  {
    id: 'web_search',
    name: '行业情报与 Web 检索网关',
    category: '外部数据',
    icon: 'WEB',
    status: 'unconnected',
    description: '演示未接。不抓取外网。',
    features: ['未接', '演示'],
  },
]

export const OFFICE_SUGGESTIONS: readonly { title: string; prompt: string; category: string }[] = [
  {
    title: '比对竞品价格表，测算对我方毛利率的影响，输出 Excel 分析报表。',
    prompt: '比对竞品最新价格表与我方华东基准价，测算毛利率波动，生成交叉对比表格与分析结论。',
    category: '数据分析',
  },
  {
    title: '根据本周材料起草给管理层的周报，提炼 3 点进展、2 点风险与下周计划。',
    prompt: '根据材料夹中的销售周报底稿和会议纪要，出一份结构化、可直接汇报的第 12 周工作周报。',
    category: '公文周报',
  },
  {
    title: '将本周华东业务复盘整理成 8 页管理层汇报 PPT 提纲与逐页卡片。',
    prompt: '把华东区域业务进展与竞品对策拆解成 8 页管理层汇报 PPT 提纲与幻灯片内容。',
    category: '汇报PPT',
  },
  {
    title: '审查续约采购合同初稿，排查付款、违约金与排他条款，出具法务意见书。',
    prompt: '审查材料夹中的续约合同草案，抽取核心义务、关键日期与金额，并列出风险等级与修改建议。',
    category: '法务审查',
  },
]

export const QUICK_REFINEMENT_ACTIONS = [
  { id: 'concise', label: '精简为一页纸', prompt: '请将上述交付内容精简为一页纸核心结论与决策摘要' },
  { id: 'actions', label: '提炼待办清单', prompt: '请从上述内容中提取明确的 Action Items 待办清单，标明负责人与DDL' },
  { id: 'english', label: '生成英文版 (EN)', prompt: '请将上述报告翻译并生成符合国际商务习惯的英文版 Executive Summary' },
  { id: 'to_ppt', label: '转为汇报 PPT', prompt: '请将上述文档结构化转换为 8 页汇报 PPT 提纲与演讲要点' },
  { id: 'add_data', label: '强化数据对比', prompt: '请在正文中强化数据指标与前后同比环比分析' },
]
