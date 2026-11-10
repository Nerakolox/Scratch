import type { BlockKind, TipTapNode } from './models/types'

const LIST_TYPES = new Set(['bulletList', 'orderedList', 'taskList'])

export function nodeText(node: TipTapNode | undefined | null): string {
  if (!node) return ''
  if (typeof node.text === 'string') return node.text
  if (!node.content || node.content.length === 0) return ''
  return node.content
    .map((child) => {
      if (child.type === 'hardBreak') return '\n'
      return nodeText(child)
    })
    .join('')
}

/** Flatten a node into readable text, with structural separators for previews/search. */
export function nodeToPlainText(node: TipTapNode | undefined | null): string {
  if (!node) return ''
  switch (node.type) {
    case 'text':
      return node.text ?? ''
    case 'hardBreak':
      return '\n'
    case 'horizontalRule':
      return '—'
    case 'codeBlock':
      return nodeText(node)
    case 'image':
      return typeof node.attrs?.alt === 'string' && node.attrs.alt ? node.attrs.alt : '[图片]'
    case 'listItem':
    case 'taskItem':
      return `• ${(node.content ?? []).map(nodeToPlainText).join('')}`
    case 'paragraph':
    case 'heading':
    case 'blockquote':
      return (node.content ?? []).map(nodeToPlainText).join('')
    default:
      if (LIST_TYPES.has(node.type)) {
        return (node.content ?? []).map(nodeToPlainText).join('\n')
      }
      return (node.content ?? []).map(nodeToPlainText).join('')
  }
}

export function docToPlainText(doc: TipTapNode | undefined | null): string {
  if (!doc) return ''
  const nodes = doc.type === 'doc' ? (doc.content ?? []) : [doc]
  return nodes
    .map(nodeToPlainText)
    .filter((part) => part.trim().length > 0)
    .join('\n')
}

export function nodeKind(node: TipTapNode): BlockKind {
  if (node.type === 'image') return 'image'
  if (node.type === 'codeBlock') return 'code'
  return 'richtext'
}

/**
 * Whether an editor node deserves to become a persisted Block.
 * Empty trailing paragraphs (which every editor doc has) must not turn into
 * phantom canvas cards; images/HRs count even without text.
 */
export function isNodeMeaningful(node: TipTapNode): boolean {
  if (node.type === 'image') {
    return typeof node.attrs?.assetId === 'string' && node.attrs.assetId.length > 0
  }
  if (node.type === 'horizontalRule') return true
  return nodeText(node).trim().length > 0
}

export function blockIdOf(node: TipTapNode): string | null {
  const id = node.attrs?.blockId
  return typeof id === 'string' && id.length > 0 ? id : null
}

export function withBlockId(node: TipTapNode, blockId: string): TipTapNode {
  return { ...node, attrs: { ...(node.attrs ?? {}), blockId } }
}

export function getBlockId(node: TipTapNode): string | null {
  return blockIdOf(node)
}

export function imageAssetId(node: TipTapNode): string | null {
  if (node.type !== 'image') return null
  const id = node.attrs?.assetId
  return typeof id === 'string' && id.length > 0 ? id : null
}

export function collectAssetIds(node: TipTapNode | undefined | null, out: Set<string>): void {
  if (!node) return
  const assetId = imageAssetId(node)
  if (assetId) out.add(assetId)
  for (const child of node.content ?? []) collectAssetIds(child, out)
}

export function titleCandidateFromDoc(doc: TipTapNode | undefined | null): string {
  if (!doc) return ''
  const nodes = doc.type === 'doc' ? (doc.content ?? []) : [doc]
  for (const node of nodes) {
    if (node.type === 'image' || node.type === 'horizontalRule') continue
    const text = nodeToPlainText(node).replace(/\s+/g, ' ').trim()
    if (text) return text.slice(0, 80)
  }
  return ''
}

function escapeMarkdown(text: string): string {
  return text.replace(/([\\`*_{}[\]()#+\-.!|>])/g, '\\$1')
}

function inlineMarkdown(node: TipTapNode): string {
  if (node.type === 'hardBreak') return '  \n'
  if (node.type === 'text') {
    let text = node.text ?? ''
    for (const mark of node.marks ?? []) {
      switch (mark.type) {
        case 'bold':
          text = `**${text}**`
          break
        case 'italic':
          text = `*${text}*`
          break
        case 'strike':
          text = `~~${text}~~`
          break
        case 'code':
          text = `\`${text}\``
          break
        case 'link': {
          const href = typeof mark.attrs?.href === 'string' ? mark.attrs.href : ''
          text = href ? `[${text}](${href})` : text
          break
        }
        default:
          break
      }
    }
    // Escape only plain text segments, not markdown we just inserted.
    return node.marks?.length ? text : escapeMarkdown(text)
  }
  if (node.type === 'image') {
    const alt = typeof node.attrs?.alt === 'string' ? node.attrs.alt : ''
    const assetId = imageAssetId(node)
    return `![${alt}](scratch-asset:${assetId ?? ''})`
  }
  return (node.content ?? []).map(inlineMarkdown).join('')
}

function blockMarkdown(node: TipTapNode, depth = 0): string {
  const indent = '  '.repeat(depth)
  switch (node.type) {
    case 'heading': {
      const level = typeof node.attrs?.level === 'number' ? node.attrs.level : 1
      return `${'#'.repeat(Math.min(6, Math.max(1, level)))} ${inlineMarkdown(node)}`
    }
    case 'paragraph':
      return inlineMarkdown(node)
    case 'blockquote': {
      const inner = (node.content ?? []).map((child) => blockMarkdown(child, 0)).join('\n\n')
      return inner
        .split('\n')
        .map((line) => (line ? `> ${line}` : '>'))
        .join('\n')
    }
    case 'codeBlock': {
      const language = typeof node.attrs?.language === 'string' ? node.attrs.language : ''
      return `\`\`\`${language}\n${nodeText(node)}\n\`\`\``
    }
    case 'horizontalRule':
      return '---'
    case 'bulletList':
      return (node.content ?? [])
        .map((item) => {
          const body = (item.content ?? []).map((child) => blockMarkdown(child, depth + 1)).join('\n')
          return `${indent}- ${body.replace(/^\s+/, '')}`
        })
        .join('\n')
    case 'orderedList':
      return (node.content ?? [])
        .map((item, index) => {
          const body = (item.content ?? [])
            .map((child) => blockMarkdown(child, depth + 1))
            .join('\n')
          return `${indent}${index + 1}. ${body.replace(/^\s+/, '')}`
        })
        .join('\n')
    case 'taskList':
      return (node.content ?? [])
        .map((item) => {
          const checked = item.attrs?.checked === true
          const body = (item.content ?? []).map((child) => blockMarkdown(child, depth + 1)).join('\n')
          return `${indent}- [${checked ? 'x' : ' '}] ${body.replace(/^\s+/, '')}`
        })
        .join('\n')
    case 'listItem':
    case 'taskItem':
      return (node.content ?? []).map((child) => blockMarkdown(child, depth)).join('\n')
    default:
      return inlineMarkdown(node)
  }
}

export function nodesToMarkdown(nodes: TipTapNode[], title?: string): string {
  const body = nodes
    .map((node) => blockMarkdown(node))
    .filter((part) => part.trim().length > 0)
    .join('\n\n')
  const heading = title && title.trim() ? `# ${title.trim()}\n\n` : ''
  return `${heading}${body}\n`
}

export function createParagraphNode(blockId?: string): TipTapNode {
  return {
    type: 'paragraph',
    ...(blockId ? { attrs: { blockId } } : {}),
  }
}

export function createCodeBlockNode(blockId?: string): TipTapNode {
  return {
    type: 'codeBlock',
    attrs: { language: null, ...(blockId ? { blockId } : {}) },
  }
}
