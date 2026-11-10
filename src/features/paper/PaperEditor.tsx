import { useCallback, useEffect, useRef, useState, type ChangeEvent } from 'react'
import { createPortal } from 'react-dom'
import { EditorContent, useEditor, type Editor } from '@tiptap/react'
import { BubbleMenu } from '@tiptap/react/menus'
import StarterKit from '@tiptap/starter-kit'
import Placeholder from '@tiptap/extension-placeholder'
import TaskList from '@tiptap/extension-task-list'
import TaskItem from '@tiptap/extension-task-item'
import { TableKit } from '@tiptap/extension-table'
import Typography from '@tiptap/extension-typography'
import { DragHandle } from '@tiptap/extension-drag-handle-react'
import { common, createLowlight } from 'lowlight'
import {
  Bold,
  Code,
  GripVertical,
  Italic,
  Link2,
  Strikethrough,
} from 'lucide-react'
import type { TipTapNode } from '@/core/models/types'
import { nodeToPlainText } from '@/core/content'
import { useDocumentService, useServiceState } from '@/features/workspace/WorkspaceContext'
import { AssetImage, BlockIds, CodeBlockWithTools } from './extensions'
import { DeletionGhost } from './deletion-ghost'
import { filterSlashCommands, type SlashCommand } from './slash-commands'
import { Dialog, IconButton, inputClass } from '@/shared/ui'
import { toast } from '@/shared/toast'
import { formatRelativeTime } from '@/shared/format'
import { markdownToHtml, shouldConvertMarkdownClipboard } from './markdown-paste'

const lowlight = createLowlight(common)

interface SlashState {
  from: number
  query: string
  left: number
  top: number
}

function detectSlash(editor: Editor): SlashState | null {
  const { selection } = editor.state
  if (!selection.empty) return null
  const { $from } = selection
  if ($from.parent.type.name !== 'paragraph' && $from.parent.type.name !== 'heading') return null
  const text = $from.parent.textContent
  if (!text.startsWith('/') || text.length > 30) return null
  const query = text.slice(1)
  if (query.includes('\n')) return null
  const coords = editor.view.coordsAtPos(selection.from)
  const width = 288
  const height = 340
  const left = Math.max(12, Math.min(coords.left, window.innerWidth - width - 12))
  const top =
    coords.bottom + height > window.innerHeight - 12
      ? Math.max(12, coords.top - height - 6)
      : coords.bottom + 6
  return { from: $from.start(), query, left, top }
}

function docFromBlocks(nodes: TipTapNode[]): TipTapNode {
  return {
    type: 'doc',
    content: nodes.length > 0 ? nodes : [{ type: 'paragraph' }],
  }
}

export function PaperEditor() {
  const service = useDocumentService()
  const state = useServiceState()
  const scratch = state.session.scratch
  const scratchId = scratch?.id ?? null

  const [slash, setSlash] = useState<SlashState | null>(null)
  const [activeIndex, setActiveIndex] = useState(0)
  const [linkOpen, setLinkOpen] = useState(false)
  const [linkUrl, setLinkUrl] = useState('')
  const imageInputRef = useRef<HTMLInputElement>(null)
  const editorRef = useRef<Editor | null>(null)
  const stateRef = useRef(state)
  stateRef.current = state

  const sessionNodes = state.session.blocks.map((block) => block.content.node)

  const insertImageFile = useCallback(
    async (file: File, position?: number) => {
      if (!file.type.startsWith('image/')) {
        toast('只支持图片文件', 'error')
        return
      }
      try {
        const assetId = await service.addAssetFromBlob(file)
        const editor = editorRef.current
        if (!editor || editor.isDestroyed) return
        const node = { type: 'image', attrs: { assetId, alt: file.name } }
        if (typeof position === 'number') {
          editor.chain().focus().insertContentAt(position, node).run()
        } else {
          editor.chain().focus().insertContent(node).run()
        }
        toast('图片已存入本地草稿', 'success')
      } catch (error) {
        toast(error instanceof Error ? error.message : '图片插入失败', 'error')
      }
    },
    [service],
  )

  const editor = useEditor(
    {
      extensions: [
        StarterKit.configure({
          heading: { levels: [1, 2, 3] },
          codeBlock: false,
          link: { openOnClick: false, autolink: true, linkOnPaste: true },
        }),
        Placeholder.configure({
          placeholder: '随便写点什么。输入 / 插入内容。',
        }),
        CodeBlockWithTools.configure({ lowlight, defaultLanguage: null }),
        TaskList,
        TaskItem.configure({ nested: true }),
        TableKit.configure({ table: { resizable: false } }),
        Typography,
        AssetImage.configure({ allowBase64: true }),
        BlockIds,
        DeletionGhost,
      ],
      content: docFromBlocks(sessionNodes),
      autofocus: false,
      editorProps: {
        attributes: {
          class: 'focus:outline-none',
          'aria-label': '草稿正文',
        },
        handlePaste: (_view, event) => {
          const files = Array.from(event.clipboardData?.files ?? []).filter((file) =>
            file.type.startsWith('image/'),
          )
          if (files.length > 0) {
            event.preventDefault()
            for (const file of files) void insertImageFile(file)
            return true
          }
          const clipboard = event.clipboardData
          if (!clipboard) return false
          const text = clipboard.getData('text/plain')
          const html = clipboard.getData('text/html')
          if (!shouldConvertMarkdownClipboard(text, html)) return false
          event.preventDefault()
          editorRef.current?.chain().focus().insertContent(markdownToHtml(text)).run()
          return true
        },
        handleDrop: (_view, event, _slice, moved) => {
          if (moved) return false
          const files = Array.from(event.dataTransfer?.files ?? []).filter((file) =>
            file.type.startsWith('image/'),
          )
          if (files.length === 0) return false
          event.preventDefault()
          const position = editorRef.current?.view.posAtCoords({
            left: event.clientX,
            top: event.clientY,
          })?.pos
          for (const file of files) void insertImageFile(file, position)
          return true
        },
      },
      onUpdate: ({ editor: current }) => {
        if (!scratchId) return
        void service.syncPaperDocument(current.getJSON() as TipTapNode, scratchId)
        setSlash(detectSlash(current))
      },
      onSelectionUpdate: ({ editor: current }) => {
        setSlash((previous) => {
          const next = detectSlash(current)
          if (!next && !previous) return previous
          return next
        })
      },
    },
    [scratchId],
  )

  useEffect(() => {
    editorRef.current = editor
    return () => {
      editorRef.current = null
    }
  }, [editor])

  // Focus on a genuinely empty scratch (desktop only, avoid mobile keyboard pop).
  useEffect(() => {
    if (!editor || !scratchId) return
    if (stateRef.current.session.blocks.length > 0) return
    const finePointer = window.matchMedia?.('(pointer: fine)').matches ?? true
    if (finePointer) {
      const timer = window.setTimeout(() => {
        if (!editor.isDestroyed) editor.commands.focus('end')
      }, 60)
      return () => window.clearTimeout(timer)
    }
  }, [editor, scratchId])

  // External content replacement (other tab / restore).
  useEffect(() => {
    if (!editor || editor.isDestroyed) return
    const nodes = stateRef.current.session.blocks.map((block) => block.content.node)
    const next = docFromBlocks(nodes)
    if (JSON.stringify(editor.getJSON()) === JSON.stringify(next)) return
    const hadFocus = editor.isFocused
    editor.commands.setContent(next, { emitUpdate: false })
    if (hadFocus) editor.commands.focus()
  }, [editor, state.externalEpoch, scratchId])

  // Flush the live document when Paper unmounts or the scratch changes.
  useEffect(() => {
    return () => {
      const current = editor
      if (current && !current.isDestroyed && scratchId) {
        void service.syncPaperDocument(current.getJSON() as TipTapNode, scratchId)
      }
    }
  }, [editor, service, scratchId])

  useEffect(() => {
    setActiveIndex(0)
  }, [slash?.query])

  const commands = filterSlashCommands(slash?.query ?? '')

  const executeCommand = useCallback(
    (command: SlashCommand) => {
      const current = editorRef.current
      if (!current || !slash) return
      const from = slash.from
      const to = current.state.selection.from
      setSlash(null)
      const chain = current.chain().focus()
      if (to > from) chain.deleteRange({ from, to })
      chain.run()
      command.run({
        editor: current,
        onPickImage: () => imageInputRef.current?.click(),
      })
    },
    [slash],
  )

  useEffect(() => {
    if (!slash) return
    function handleKey(event: KeyboardEvent) {
      if (!slash) return
      if (event.key === 'Escape') {
        event.preventDefault()
        event.stopPropagation()
        setSlash(null)
        return
      }
      if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
        event.preventDefault()
        event.stopPropagation()
        const count = Math.max(1, commands.length)
        setActiveIndex((index) =>
          event.key === 'ArrowDown' ? (index + 1) % count : (index - 1 + count) % count,
        )
        return
      }
      if (event.key === 'Enter' || event.key === 'Tab') {
        const command = commands[activeIndex] ?? commands[0]
        if (!command) return
        event.preventDefault()
        event.stopPropagation()
        executeCommand(command)
      }
    }
    window.addEventListener('keydown', handleKey, true)
    return () => window.removeEventListener('keydown', handleKey, true)
  }, [slash, commands, activeIndex, executeCommand])

  const openLinkDialog = useCallback(() => {
    if (!editor) return
    const existing = editor.getAttributes('link').href
    setLinkUrl(typeof existing === 'string' ? existing : '')
    setLinkOpen(true)
  }, [editor])

  const applyLink = useCallback(() => {
    if (!editor) return
    const raw = linkUrl.trim()
    setLinkOpen(false)
    if (!raw) {
      editor.chain().focus().extendMarkRange('link').unsetLink().run()
      return
    }
    const href = /^(https?:|mailto:|#|\/)/i.test(raw) ? raw : `https://${raw}`
    editor.chain().focus().extendMarkRange('link').setLink({ href }).run()
  }, [editor, linkUrl])

  const handleFileInput = (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0]
    if (file) void insertImageFile(file)
    event.target.value = ''
  }

  const wordCount = state.session.blocks.reduce(
    (total, block) => total + nodeToPlainText(block.content.node).replace(/\s/g, '').length,
    0,
  )

  if (!scratch) return null

  return (
    <div className="h-full overflow-y-auto">
      <div className="mx-auto w-full max-w-[800px] px-4 py-4 md:px-6 md:py-5">
        <div className="min-h-[calc(100vh-9rem)] rounded-sheet bg-elevated px-6 pb-28 pt-10 shadow-sheet md:px-14 md:pb-36 md:pt-14">
          <input
            value={scratch.title}
            onChange={(event) => void service.renameScratch(scratch.id, event.target.value)}
            onKeyDown={(event) => {
              if (event.key === 'Enter' || event.key === 'ArrowDown') {
                event.preventDefault()
                editor?.commands.focus('start')
              }
            }}
            placeholder="未命名草稿"
            aria-label="草稿标题"
            spellCheck={false}
            className="w-full bg-transparent text-[28px] font-semibold leading-tight tracking-[-0.015em] text-ink outline-none placeholder:text-faint md:text-[32px]"
          />
          <div className="mt-2 flex items-center gap-2 text-[11.5px] text-faint">
            <span>更新于 {formatRelativeTime(scratch.updatedAt)}</span>
            {wordCount > 0 && (
              <>
                <span aria-hidden>·</span>
                <span>{wordCount} 字</span>
              </>
            )}
          </div>

          <div className="scratch-prose mt-8">
            {editor && (
              <BubbleMenu
                editor={editor}
                className="flex items-center gap-0.5 rounded-lg border border-line bg-elevated p-1 shadow-md motion-menu"
              >
                <IconButton
                  label="加粗"
                  size="sm"
                  active={editor.isActive('bold')}
                  onMouseDown={(event) => event.preventDefault()}
                  onClick={() => editor.chain().focus().toggleBold().run()}
                >
                  <Bold size={14} />
                </IconButton>
                <IconButton
                  label="斜体"
                  size="sm"
                  active={editor.isActive('italic')}
                  onMouseDown={(event) => event.preventDefault()}
                  onClick={() => editor.chain().focus().toggleItalic().run()}
                >
                  <Italic size={14} />
                </IconButton>
                <IconButton
                  label="删除线"
                  size="sm"
                  active={editor.isActive('strike')}
                  onMouseDown={(event) => event.preventDefault()}
                  onClick={() => editor.chain().focus().toggleStrike().run()}
                >
                  <Strikethrough size={14} />
                </IconButton>
                <IconButton
                  label="行内代码"
                  size="sm"
                  active={editor.isActive('code')}
                  onMouseDown={(event) => event.preventDefault()}
                  onClick={() => editor.chain().focus().toggleCode().run()}
                >
                  <Code size={14} />
                </IconButton>
                <IconButton
                  label="链接"
                  size="sm"
                  active={editor.isActive('link')}
                  onMouseDown={(event) => event.preventDefault()}
                  onClick={openLinkDialog}
                >
                  <Link2 size={14} />
                </IconButton>
              </BubbleMenu>
            )}
            {editor && (
              <DragHandle editor={editor}>
                <div
                  className="flex h-7 w-5 cursor-grab items-center justify-center rounded text-faint hover:bg-sunken hover:text-ink"
                  title="拖动以移动此块"
                >
                  <GripVertical size={14} />
                </div>
              </DragHandle>
            )}
            <EditorContent editor={editor} />
          </div>
        </div>
      </div>

      <input
        ref={imageInputRef}
        type="file"
        accept="image/*"
        className="hidden"
        onChange={handleFileInput}
      />

      {slash &&
        createPortal(
          <div
            role="listbox"
            aria-label="插入内容"
            style={{ left: slash.left, top: slash.top }}
            className="fixed z-[90] w-[288px] overflow-hidden rounded-xl border border-line bg-elevated shadow-lg motion-menu"
          >
            <div className="border-b border-line px-3 py-1.5 text-[10.5px] font-medium uppercase tracking-[0.06em] text-faint">
              插入内容
            </div>
            <div className="max-h-[300px] overflow-y-auto p-1">
              {commands.length === 0 ? (
                <div className="px-3 py-3 text-[12.5px] text-faint">没有匹配的命令</div>
              ) : (
                commands.map((command, index) => (
                  <button
                    key={command.id}
                    type="button"
                    role="option"
                    aria-selected={index === activeIndex}
                    onMouseDown={(event) => event.preventDefault()}
                    onMouseEnter={() => setActiveIndex(index)}
                    onClick={() => executeCommand(command)}
                    className={`flex w-full items-center gap-2.5 rounded-md px-2.5 py-2 text-left ${
                      index === activeIndex ? 'bg-sunken text-ink' : 'text-muted hover:bg-sunken/70'
                    }`}
                  >
                    <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-md border border-line bg-surface text-ink">
                      {command.icon}
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="block text-[13px] font-medium text-ink">{command.label}</span>
                      <span className="block truncate text-[11px] text-faint">{command.hint}</span>
                    </span>
                  </button>
                ))
              )}
            </div>
          </div>,
          document.body,
        )}

      <Dialog
        open={linkOpen}
        onClose={() => setLinkOpen(false)}
        title="插入链接"
        description="留空并确认可移除链接。"
        footer={
          <>
            <button
              type="button"
              className="rounded-lg px-3 py-1.5 text-[13px] text-muted hover:bg-sunken hover:text-ink"
              onClick={() => setLinkOpen(false)}
            >
              取消
            </button>
            <button
              type="button"
              className="rounded-lg bg-accent px-3 py-1.5 text-[13px] font-medium text-accent-ink hover:opacity-90"
              onClick={applyLink}
            >
              应用
            </button>
          </>
        }
      >
        <input
          className={inputClass}
          value={linkUrl}
          onChange={(event) => setLinkUrl(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === 'Enter') applyLink()
          }}
          placeholder="https://example.com"
          autoFocus
          aria-label="链接地址"
        />
      </Dialog>
    </div>
  )
}
