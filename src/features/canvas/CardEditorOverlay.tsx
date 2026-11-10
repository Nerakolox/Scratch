import { useCallback, useEffect, useRef } from 'react'
import { EditorContent, useEditor, type Editor } from '@tiptap/react'
import StarterKit from '@tiptap/starter-kit'
import Placeholder from '@tiptap/extension-placeholder'
import TaskList from '@tiptap/extension-task-list'
import TaskItem from '@tiptap/extension-task-item'
import { TableKit } from '@tiptap/extension-table'
import { common, createLowlight } from 'lowlight'
import { Check, PencilLine } from 'lucide-react'
import type { TipTapNode } from '@/core/models/types'
import { useDocumentService, useServiceState } from '@/features/workspace/WorkspaceContext'
import { AssetImage, BlockIds, CodeBlockWithTools } from '@/features/paper/extensions'
import { markdownToHtml, shouldConvertMarkdownClipboard } from '@/features/paper/markdown-paste'
import { Button } from '@/shared/ui'

const lowlight = createLowlight(common)

export interface CardRect {
  left: number
  top: number
  width: number
  height: number
}

export function CardEditorOverlay({
  blockId,
  rect,
  onClose,
}: {
  blockId: string
  rect: CardRect
  onClose: () => void
}) {
  const service = useDocumentService()
  const { session } = useServiceState()
  const block = session.blocks.find((candidate) => candidate.id === blockId)
  const editorRef = useRef<Editor | null>(null)
  const panelRef = useRef<HTMLDivElement>(null)
  const closedRef = useRef(false)

  const commit = useCallback(() => {
    if (closedRef.current) return
    closedRef.current = true
    const current = editorRef.current
    if (!current || current.isDestroyed) {
      onClose()
      return
    }
    const finish = () => {
      if (!current.isDestroyed) {
        const nodes = (current.getJSON() as TipTapNode).content ?? []
        void service.replaceBlockWithNodes(blockId, nodes)
      }
      onClose()
    }
    // Commit any in-flight IME composition before reading the document. CI
    // browsers can keep the last piece of a CJK input in composition when a
    // button is clicked immediately after typing.
    const composing = current.view.composing
    current.view.dom.blur()
    window.setTimeout(finish, composing ? 60 : 0)
  }, [blockId, onClose, service])

  const editor = useEditor(
    {
      extensions: [
        StarterKit.configure({
          heading: { levels: [1, 2, 3] },
          codeBlock: false,
          link: { openOnClick: false, autolink: true, linkOnPaste: true },
        }),
        Placeholder.configure({ placeholder: '卡片内容…' }),
        CodeBlockWithTools.configure({ lowlight, defaultLanguage: null }),
        TaskList,
        TaskItem.configure({ nested: true }),
        TableKit.configure({ table: { resizable: false } }),
        AssetImage.configure({ allowBase64: true }),
        BlockIds,
      ],
      content: {
        type: 'doc',
        content: block?.content.node ? [block.content.node] : [{ type: 'paragraph' }],
      },
      autofocus: 'end',
      editorProps: {
        attributes: {
          class: 'focus:outline-none',
          'aria-label': '卡片内容',
        },
        handlePaste: (_view, event) => {
          const clipboard = event.clipboardData
          if (!clipboard) return false
          const text = clipboard.getData('text/plain')
          const html = clipboard.getData('text/html')
          if (!shouldConvertMarkdownClipboard(text, html)) return false
          event.preventDefault()
          editorRef.current?.chain().focus().insertContent(markdownToHtml(text)).run()
          return true
        },
        handleKeyDown: (view, event) => {
          if (event.key === 'Escape') {
            event.preventDefault()
            commit()
            return true
          }
          if (event.key === 'Enter' && (event.metaKey || event.ctrlKey)) {
            event.preventDefault()
            commit()
            return true
          }
          if (
            event.key === 'Enter' &&
            !event.shiftKey &&
            !event.metaKey &&
            !event.ctrlKey &&
            !event.altKey
          ) {
            const parentName = view.state.selection.$from.parent.type.name
            if (parentName === 'paragraph' || parentName === 'heading') {
              event.preventDefault()
              const hardBreak = view.state.schema.nodes.hardBreak?.create()
              if (hardBreak) {
                view.dispatch(view.state.tr.replaceSelectionWith(hardBreak))
              }
              return true
            }
          }
          return false
        },
      },
      onUpdate: ({ editor: current }) => {
        const nodes = (current.getJSON() as TipTapNode).content ?? []
        const first = nodes[0]
        if (first) void service.syncBlockNode(blockId, first)
      },
    },
    [blockId],
  )

  useEffect(() => {
    editorRef.current = editor
    return () => {
      editorRef.current = null
    }
  }, [editor])

  useEffect(() => {
    function handlePointer(event: PointerEvent) {
      if (panelRef.current && !panelRef.current.contains(event.target as Node)) {
        commit()
      }
    }
    document.addEventListener('pointerdown', handlePointer, true)
    return () => document.removeEventListener('pointerdown', handlePointer, true)
  }, [commit])

  useEffect(() => {
    return () => {
      if (closedRef.current) return
      const current = editorRef.current
      if (current && !current.isDestroyed) {
        const nodes = (current.getJSON() as TipTapNode).content ?? []
        void service.replaceBlockWithNodes(blockId, nodes)
      }
    }
  }, [blockId, service])

  return (
    <div
      ref={panelRef}
      className="scratch-card-editor"
      style={{ left: rect.left, top: rect.top, width: rect.width, height: rect.height }}
      role="dialog"
      aria-label="编辑卡片内容"
    >
      <div className="scratch-card-editor__bar">
        <span className="inline-flex items-center gap-1.5">
          <PencilLine size={12} aria-hidden />
          编辑卡片
        </span>
        <Button size="sm" variant="primary" icon={<Check size={13} />} onClick={commit}>
          完成
        </Button>
      </div>
      <div className="scratch-card-editor__content">
        {block ? (
          <EditorContent editor={editor} />
        ) : (
          <p className="text-[13px] text-faint">这个块已被删除。</p>
        )}
      </div>
      <div className="border-t border-line px-3 py-1.5 text-[10.5px] text-faint">
        Esc 或 ⌘/Ctrl + Enter 完成 · 单击卡片外部也会保存
      </div>
    </div>
  )
}
