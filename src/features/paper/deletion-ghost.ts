import { Extension } from '@tiptap/core'
import { Plugin, PluginKey, type EditorState, type Transaction } from '@tiptap/pm/state'
import { Decoration, DecorationSet, type EditorView } from '@tiptap/pm/view'

const GHOST_KEY = new PluginKey<DecorationSet>('scratchDeletionGhost')

const MAX_GHOST = 16
const CLEAR_DELAY = 280
const GHOST_INTERVAL = 70

let lastGhostAt = 0

function makeGhost(view: EditorView, pos: number, text: string): HTMLElement {
  const el = document.createElement('span')
  el.className = 'scratch-type-ghost'
  el.textContent = text
  el.setAttribute('aria-hidden', 'true')
  try {
    const coords = view.coordsAtPos(pos)
    el.style.left = `${coords.left}px`
    el.style.top = `${coords.top}px`

    // The ghost is fixed to the viewport, so copy the editor's font metrics
    // inline to land on the exact line and column of the deleted text.
    const node = view.domAtPos(pos).node
    const host = node instanceof HTMLElement ? node : node.parentElement
    if (host) {
      const style = getComputedStyle(host)
      el.style.fontFamily = style.fontFamily
      el.style.fontSize = style.fontSize
      el.style.fontWeight = style.fontWeight
      el.style.fontStyle = style.fontStyle
      el.style.letterSpacing = style.letterSpacing
      el.style.lineHeight = style.lineHeight
      el.style.color = style.color
    }
  } catch {
    // The editor may already be torn down; the ghost simply renders in flow.
  }
  return el
}

function ghostDecoration(tr: Transaction, oldState: EditorState): Decoration | null {
  if (!tr.docChanged || tr.steps.length !== 1) return null

  // Duck-typed on purpose: the ReplaceStep class can come from a different
  // prosemirror-transform instance than this bundle, which breaks instanceof.
  const step = tr.steps[0] as unknown as {
    from?: number
    to?: number
    slice?: { size?: number }
    gapFrom?: number
    gapTo?: number
  }
  if (typeof step.from !== 'number' || typeof step.to !== 'number') return null
  if (!step.slice || typeof step.slice.size !== 'number') return null
  // ReplaceAroundStep wraps structure (lists, block attributes); leave it alone.
  if (step.gapFrom !== undefined || step.gapTo !== undefined) return null
  // A replacement inserts new content; only pure deletions get a ghost.
  if (step.slice.size > 0) return null

  const deleted = step.to - step.from
  if (deleted <= 0 || deleted > MAX_GHOST) return null
  if (Date.now() - lastGhostAt <= GHOST_INTERVAL) return null

  const text = oldState.doc.textBetween(step.from, step.to, ' ')
  if (!text || text.includes('\n') || text.trim().length === 0) return null

  lastGhostAt = Date.now()
  const pos = Math.min(step.from, tr.doc.content.size)
  return Decoration.widget(pos, (view) => makeGhost(view, pos, text), {
    side: 1,
    ignoreSelection: true,
  })
}

/**
 * A short ghost of deleted text that blurs out at the exact caret position.
 * Insertions are intentionally left alone.
 */
export const DeletionGhost = Extension.create({
  name: 'scratchDeletionGhost',

  addProseMirrorPlugins() {
    return [
      new Plugin<DecorationSet>({
        key: GHOST_KEY,

        props: {
          decorations(state) {
            return GHOST_KEY.getState(state) ?? DecorationSet.empty
          },
        },

        state: {
          init: () => DecorationSet.empty,

          apply(tr, previous, oldState) {
            if (tr.getMeta(GHOST_KEY)) return DecorationSet.empty
            let ghosts = previous.map(tr.mapping, tr.doc)
            const ghost = ghostDecoration(tr, oldState)
            if (ghost) ghosts = ghosts.add(tr.doc, [ghost])
            return ghosts
          },
        },

        view(editorView) {
          let clearTimer: number | null = null

          const scheduleClear = () => {
            if (clearTimer !== null) window.clearTimeout(clearTimer)
            clearTimer = window.setTimeout(() => {
              clearTimer = null
              if (!editorView.isDestroyed) {
                editorView.dispatch(
                  editorView.state.tr.setMeta(GHOST_KEY, { clear: true }),
                )
              }
            }, CLEAR_DELAY)
          }

          return {
            update(view) {
              const ghosts = GHOST_KEY.getState(view.state)
              if (ghosts && ghosts.find().length > 0) scheduleClear()
            },
            destroy() {
              if (clearTimer !== null) window.clearTimeout(clearTimer)
            },
          }
        },
      }),
    ]
  },
})
