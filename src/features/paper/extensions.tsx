import { Extension } from '@tiptap/core'
import { Plugin, PluginKey, type Transaction } from '@tiptap/pm/state'
import Image from '@tiptap/extension-image'
import CodeBlockLowlight from '@tiptap/extension-code-block-lowlight'
import {
  ReactNodeViewRenderer,
  NodeViewContent,
  NodeViewWrapper,
  type NodeViewProps,
} from '@tiptap/react'
import { useEffect, useState } from 'react'
import { Check, Copy, ImageOff, Loader2 } from 'lucide-react'
import { useDocumentService } from '@/features/workspace/WorkspaceContext'
import { newId } from '@/core/utils'

export const TOP_LEVEL_BLOCK_TYPES = [
  'paragraph',
  'heading',
  'blockquote',
  'codeBlock',
  'bulletList',
  'orderedList',
  'taskList',
  'table',
  'horizontalRule',
  'image',
]

/**
 * Every top-level node carries a stable `blockId`. The plugin assigns IDs to
 * new nodes and de-duplicates IDs copied by Enter-splits or paste, which is
 * what lets Paper order and Canvas cards share one identity.
 */
export const BlockIds = Extension.create({
  name: 'scratchBlockIds',

  addGlobalAttributes() {
    return [
      {
        types: TOP_LEVEL_BLOCK_TYPES,
        attributes: {
          blockId: {
            default: null,
            parseHTML: (element) => element.getAttribute('data-block-id'),
            renderHTML: (attributes) =>
              typeof attributes.blockId === 'string' && attributes.blockId
                ? { 'data-block-id': attributes.blockId }
                : {},
          },
        },
      },
    ]
  },

  addProseMirrorPlugins() {
    return [
      new Plugin({
        key: new PluginKey('scratchBlockIds'),
        appendTransaction: (transactions, _oldState, newState) => {
          if (!transactions.some((transaction) => transaction.docChanged)) return null
          const seen = new Set<string>()
          let transaction: Transaction | null = null
          newState.doc.forEach((node, offset) => {
            const blockId = node.attrs.blockId
            if (typeof blockId === 'string' && blockId.length > 0 && !seen.has(blockId)) {
              seen.add(blockId)
              return
            }
            const nextId = newId()
            transaction = (transaction ?? newState.tr).setNodeMarkup(offset, undefined, {
              ...node.attrs,
              blockId: nextId,
            })
            seen.add(nextId)
          })
          return transaction
        },
      }),
    ]
  },
})


const CODE_LANGUAGES: Array<{ value: string; label: string }> = [
  { value: '', label: '纯文本' },
  { value: 'typescript', label: 'TypeScript' },
  { value: 'javascript', label: 'JavaScript' },
  { value: 'json', label: 'JSON' },
  { value: 'python', label: 'Python' },
  { value: 'bash', label: 'Shell' },
  { value: 'css', label: 'CSS' },
  { value: 'xml', label: 'HTML / XML' },
  { value: 'markdown', label: 'Markdown' },
  { value: 'sql', label: 'SQL' },
  { value: 'java', label: 'Java' },
  { value: 'go', label: 'Go' },
  { value: 'rust', label: 'Rust' },
  { value: 'c', label: 'C' },
  { value: 'cpp', label: 'C++' },
  { value: 'csharp', label: 'C#' },
  { value: 'yaml', label: 'YAML' },
  { value: 'diff', label: 'Diff' },
]

function CodeBlockView({ node, updateAttributes }: NodeViewProps) {
  const language = typeof node.attrs.language === 'string' ? node.attrs.language : ''
  const [copied, setCopied] = useState(false)

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(node.textContent)
      setCopied(true)
      window.setTimeout(() => setCopied(false), 1500)
    } catch {
      // Clipboard can be unavailable outside secure contexts; leave content selectable.
    }
  }

  return (
    <NodeViewWrapper className="scratch-codeblock">
      <div className="scratch-codeblock__bar" contentEditable={false}>
        <select
          aria-label="代码语言"
          value={language}
          onChange={(event) => updateAttributes({ language: event.target.value || null })}
        >
          {CODE_LANGUAGES.map((item) => (
            <option key={item.value || 'plain'} value={item.value}>
              {item.label}
            </option>
          ))}
        </select>
        <button
          type="button"
          className="scratch-codeblock__copy"
          onClick={() => void copy()}
          aria-label={copied ? '已复制代码' : '复制代码'}
        >
          {copied ? <Check size={12} /> : <Copy size={12} />}
          {copied ? '已复制' : '复制'}
        </button>
      </div>
      <pre>
        <NodeViewContent<'code'> as="code" />
      </pre>
    </NodeViewWrapper>
  )
}

export const CodeBlockWithTools = CodeBlockLowlight.extend({
  addNodeView() {
    return ReactNodeViewRenderer(CodeBlockView)
  },
})

function AssetImageView({ node, selected }: NodeViewProps) {
  const service = useDocumentService()
  const assetId = typeof node.attrs.assetId === 'string' ? node.attrs.assetId : null
  const directSrc = typeof node.attrs.src === 'string' ? node.attrs.src : ''
  const alt = typeof node.attrs.alt === 'string' ? node.attrs.alt : ''
  const [url, setUrl] = useState<string | null>(null)
  const [state, setState] = useState<'loading' | 'ready' | 'missing'>('loading')

  useEffect(() => {
    let alive = true
    if (!assetId) {
      if (directSrc) {
        setUrl(directSrc)
        setState('ready')
      } else {
        setUrl(null)
        setState('missing')
      }
      return () => {
        alive = false
      }
    }
    setState('loading')
    service
      .getAssetUrl(assetId)
      .then((resolved) => {
        if (!alive) return
        if (resolved) {
          setUrl(resolved)
          setState('ready')
        } else {
          setState('missing')
        }
      })
      .catch(() => {
        if (alive) setState('missing')
      })
    return () => {
      alive = false
    }
  }, [assetId, directSrc, service])

  return (
    <NodeViewWrapper
      as="figure"
      className="scratch-image-node my-3"
      data-drag-handle
      contentEditable={false}
    >
      {state === 'ready' && url ? (
        <img
          src={url}
          alt={alt}
          loading="lazy"
          referrerPolicy="no-referrer"
          className={selected ? 'rounded border-2 border-accent' : 'rounded border border-line'}
        />
      ) : state === 'loading' ? (
        <span className="flex items-center gap-2 rounded border border-line bg-sunken px-3 py-2 text-[12px] text-faint">
          <Loader2 size={13} className="animate-spin" /> 正在载入图片…
        </span>
      ) : (
        <span className="flex items-center gap-2 rounded border border-dashed border-line px-3 py-2 text-[12px] text-faint">
          <ImageOff size={13} /> 图片资源缺失（可能来自不完整的备份）
        </span>
      )}
    </NodeViewWrapper>
  )
}

/**
 * Image node backed by a MediaAsset. Only `assetId` is stored in the document;
 * the blob lives in IndexedDB and is resolved to an object URL at render time.
 */
export const AssetImage = Image.extend({
  name: 'image',

  addAttributes() {
    return {
      ...this.parent?.(),
      assetId: {
        default: null,
        parseHTML: (element) => element.getAttribute('data-asset-id'),
        renderHTML: (attributes) =>
          typeof attributes.assetId === 'string' && attributes.assetId
            ? { 'data-asset-id': attributes.assetId }
            : {},
      },
    }
  },

  addNodeView() {
    return ReactNodeViewRenderer(AssetImageView)
  },
})
