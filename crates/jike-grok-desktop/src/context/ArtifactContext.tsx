/* eslint-disable react-refresh/only-export-components */
import { createContext, useContext, useState, useCallback, type ReactNode } from 'react'

export interface ArtifactContent {
  id: string
  language: 'html' | 'svg'
  code: string
}

interface ArtifactContextValue {
  activeArtifact: ArtifactContent | null
  workspaceRoot: string
  openArtifact: (language: 'html' | 'svg', code: string) => void
  closeArtifact: () => void
}

const ArtifactContext = createContext<ArtifactContextValue | null>(null)

export function ArtifactProvider({
  children,
  workspaceRoot,
}: {
  children: ReactNode
  workspaceRoot: string
}) {
  const [activeArtifact, setActiveArtifact] = useState<ArtifactContent | null>(null)

  const openArtifact = useCallback((language: 'html' | 'svg', code: string) => {
    setActiveArtifact({ id: crypto.randomUUID(), language, code })
  }, [])

  const closeArtifact = useCallback(() => {
    setActiveArtifact(null)
  }, [])

  return (
    <ArtifactContext.Provider value={{ activeArtifact, workspaceRoot, openArtifact, closeArtifact }}>
      {children}
    </ArtifactContext.Provider>
  )
}

export function useArtifact() {
  const ctx = useContext(ArtifactContext)
  if (!ctx) throw new Error('useArtifact must be used within ArtifactProvider')
  return ctx
}
