import type { ReactNode } from 'react'
import {
  IconBooks,
  IconCircleDot,
  IconCode,
  IconDatabase,
  IconGitBranch,
  IconGitFork,
  IconGitMerge,
  IconHierarchy2,
  IconHttpDelete,
  IconPlayerPlay,
  IconRepeat,
  IconSparkles,
  IconSquareRoundedCheck,
  IconTerminal2,
  IconVariable,
} from '@tabler/icons-react'
import type { FlowNodeType } from '../flow'

export const PALETTE_META: Record<FlowNodeType, { icon: ReactNode }> = {
  start: { icon: <IconPlayerPlay size={18} stroke={2} /> },
  agent: { icon: <IconSparkles size={18} stroke={2} /> },
  tool: { icon: <IconTerminal2 size={18} stroke={2} /> },
  http: { icon: <IconHttpDelete size={18} stroke={2} /> },
  database: { icon: <IconDatabase size={18} stroke={2} /> },
  knowledge: { icon: <IconBooks size={18} stroke={2} /> },
  variable: { icon: <IconVariable size={18} stroke={2} /> },
  transform: { icon: <IconCode size={18} stroke={2} /> },
  loop: { icon: <IconRepeat size={18} stroke={2} /> },
  loop_end: { icon: <IconCircleDot size={18} stroke={2} /> },
  flow: { icon: <IconHierarchy2 size={18} stroke={2} /> },
  branch: { icon: <IconGitBranch size={18} stroke={2} /> },
  parallel: { icon: <IconGitFork size={18} stroke={2} /> },
  join: { icon: <IconGitMerge size={18} stroke={2} /> },
  end: { icon: <IconSquareRoundedCheck size={18} stroke={2} /> },
}
