import { createContext, useContext } from 'react'

export interface FlowCanvasContextValue {
  onRunFromHere?: (nodeId: string) => void
  onDuplicate?: (nodeId: string) => void
  onDeleteNode?: (nodeId: string) => void
}

export const FlowCanvasContext = createContext<FlowCanvasContextValue>({})

export const useFlowCanvas = () => useContext(FlowCanvasContext)
