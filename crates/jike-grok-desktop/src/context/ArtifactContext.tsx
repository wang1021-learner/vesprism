/**
 * 兼容层：Artifact 已并入统一右侧 SidePanel。
 * 新代码请直接 `import { useSidePanel, SidePanelProvider } from './SidePanelContext'`。
 */
export {
  SidePanelProvider as ArtifactProvider,
  useSidePanel as useArtifact,
  useSidePanel,
  SidePanelProvider,
} from './SidePanelContext'
export type { SidePanelPayload } from './SidePanelContext'
