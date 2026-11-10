export type ID = string
export type UnixMs = number
export type ScratchMode = 'paper' | 'canvas'
export type BlockKind = 'richtext' | 'code' | 'image'

export interface Scratch {
  id: ID
  title: string
  /** True while the title is derived from the first line of content. */
  titleIsAuto: boolean
  activeMode: ScratchMode
  createdAt: UnixMs
  updatedAt: UnixMs
  revision: number
  deletedAt?: UnixMs
}

export interface TipTapMark {
  type: string
  attrs?: Record<string, unknown>
}

/** A single top-level ProseMirror/Tiptap node. Its `attrs.blockId` is its stable Block ID. */
export interface TipTapNode {
  type: string
  attrs?: Record<string, unknown>
  content?: TipTapNode[]
  marks?: TipTapMark[]
  text?: string
}

export interface BlockContent {
  node: TipTapNode
}

export interface ContentBlock {
  id: ID
  scratchId: ID
  kind: BlockKind
  content: BlockContent
  createdAt: UnixMs
  updatedAt: UnixMs
  revision: number
}

export interface PaperLayout {
  scratchId: ID
  blockOrder: ID[]
}

export interface CanvasLayoutRecord {
  scratchId: ID
  /** Opaque tldraw store snapshot. Validated for shape, not deep-imported. */
  snapshot: unknown | null
  /** Camera / local-only session state. Excluded from backup archives. */
  sessionState?: unknown
  hiddenBlockIds: ID[]
  updatedAt: UnixMs
}

export interface MediaAsset {
  id: ID
  mimeType: string
  size: number
  sha256?: string
  createdAt: UnixMs
  blob: Blob
}

export interface SessionSnapshot {
  scratch: Scratch | null
  blocks: ContentBlock[]
  order: ID[]
  canvas: CanvasLayoutRecord | null
  /** Bumped when content was replaced from outside (other tab / restore). */
  externalEpoch: number
}

export type SavePhase = 'idle' | 'saving' | 'saved' | 'error' | 'conflict'

export interface SaveStatus {
  phase: SavePhase
  message?: string
  at?: UnixMs
}

export interface ConflictInfo {
  localRevision: number
  remoteRevision: number
}

export interface ScratchSearchResult {
  scratch: Scratch
  snippet: string
  score: number
}

export interface Dataset {
  scratches: Scratch[]
  blocks: ContentBlock[]
  paperLayouts: PaperLayout[]
  canvasLayouts: CanvasLayoutRecord[]
  assets: Array<MediaAsset & { bytes: Uint8Array }>
}
