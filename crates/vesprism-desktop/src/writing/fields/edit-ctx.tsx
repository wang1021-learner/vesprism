import { createContext, useContext, type ReactNode } from 'react'
import type { BookDemo } from '../model/types'

export type PatchBook = (fn: (book: BookDemo) => BookDemo) => void

export const BookPatchCtx = createContext<PatchBook | null>(null)
export const AiFillCtx = createContext<((label: string) => void) | null>(null)

export function DeskEdit({
  patch,
  onAiFill,
  children,
}: {
  patch: PatchBook
  onAiFill: (label: string) => void
  children: ReactNode
}) {
  return (
    <BookPatchCtx.Provider value={patch}>
      <AiFillCtx.Provider value={onAiFill}>{children}</AiFillCtx.Provider>
    </BookPatchCtx.Provider>
  )
}

export function usePatch(): PatchBook {
  const patch = useContext(BookPatchCtx)
  if (!patch) throw new Error('usePatch 必须在写台里')
  return patch
}

export function useOptionalPatch(): PatchBook | null {
  return useContext(BookPatchCtx)
}
