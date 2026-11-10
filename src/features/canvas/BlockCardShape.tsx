import { useEffect, useState, type ReactNode } from 'react'
import { BaseBoxShapeUtil, HTMLContainer, T, type RecordProps, type TLBaseShape } from 'tldraw'
import { useDocumentService, useServiceState } from '@/features/workspace/WorkspaceContext'
import { nodeText } from '@/core/content'
import type { TipTapNode } from '@/core/models/types'

export const EDIT_CARD_EVENT = 'scratch:edit-card'

export interface BlockCardShapeProps {
  w: number
  h: number
  blockId: string
}

declare module 'tldraw' {
  export interface TLGlobalShapePropsMap {
    'block-card': BlockCardShapeProps
  }
}

export type BlockCardShape = TLBaseShape<'block-card', BlockCardShapeProps>

export const DEFAULT_CARD_WIDTH = 300
export const DEFAULT_CARD_HEIGHT = 200
export const CARD_GAP = 48

function PreviewImage({
  assetId,
  alt,
  src,
}: {
  assetId: string
  alt: string
  src: string
}) {
  const service = useDocumentService()
  const [url, setUrl] = useState<string | null>(src || null)
  useEffect(() => {
    if (!assetId) {
      setUrl(src || null)
      return
    }
    let alive = true
    service
      .getAssetUrl(assetId)
      .then((resolved) => {
        if (alive) setUrl(resolved)
      })
      .catch(() => undefined)
    return () => {
      alive = false
    }
  }, [assetId, service, src])
  if (!url) return <span className="scratch-block-card__empty">图片载入中…</span>
  return (
    <img src={url} alt={alt} loading="lazy" referrerPolicy="no-referrer" draggable={false} />
  )
}

function renderText(node: TipTapNode, key: string): ReactNode {
  let element: ReactNode = node.text ?? ''
  for (const mark of node.marks ?? []) {
    switch (mark.type) {
      case 'bold':
        element = <strong>{element}</strong>
        break
      case 'italic':
        element = <em>{element}</em>
        break
      case 'strike':
        element = <s>{element}</s>
        break
      case 'code':
        element = <code>{element}</code>
        break
      case 'link': {
        const href = typeof mark.attrs?.href === 'string' ? mark.attrs.href : ''
        element = href ? <span className="underline">{element}</span> : element
        break
      }
      default:
        break
    }
  }
  return <span key={key}>{element}</span>
}

function renderInline(nodes: TipTapNode[] | undefined, prefix: string): ReactNode {
  if (!nodes) return null
  return nodes.map((node, index) => {
    const key = `${prefix}-i${index}`
    if (node.type === 'hardBreak') return <br key={key} />
    if (node.type === 'image') {
      const assetId = typeof node.attrs?.assetId === 'string' ? node.attrs.assetId : ''
      const alt = typeof node.attrs?.alt === 'string' ? node.attrs.alt : ''
      const src = typeof node.attrs?.src === 'string' ? node.attrs.src : ''
      return <PreviewImage key={key} assetId={assetId} alt={alt} src={src} />
    }
    if (node.type === 'text') return renderText(node, key)
    return <span key={key}>{renderInline(node.content, key)}</span>
  })
}

function renderNode(node: TipTapNode, key: string): ReactNode {
  switch (node.type) {
    case 'paragraph':
      return <p key={key}>{renderInline(node.content, key)}</p>
    case 'heading': {
      const level = typeof node.attrs?.level === 'number' ? node.attrs.level : 1
      const Tag = (level === 1 ? 'h1' : level === 2 ? 'h2' : 'h3') as 'h1' | 'h2' | 'h3'
      return <Tag key={key}>{renderInline(node.content, key)}</Tag>
    }
    case 'blockquote':
      return <blockquote key={key}>{renderNodes(node.content, key)}</blockquote>
    case 'bulletList':
      return <ul key={key}>{renderNodes(node.content, key)}</ul>
    case 'orderedList':
      return <ol key={key}>{renderNodes(node.content, key)}</ol>
    case 'taskList':
      return (
        <ul key={key} data-type="taskList" className="list-none pl-0">
          {node.content?.map((item, index) => {
            const checked = item.attrs?.checked === true
            return (
              <li key={`${key}-t${index}`} className="flex items-start gap-1.5">
                <input
                  type="checkbox"
                  checked={checked}
                  readOnly
                  tabIndex={-1}
                  className="mt-1 accent-[var(--scratch-accent)]"
                />
                <span>{renderNodes(item.content, `${key}-t${index}`)}</span>
              </li>
            )
          })}
        </ul>
      )
    case 'listItem':
    case 'taskItem':
      return <li key={key}>{renderNodes(node.content, key)}</li>
    case 'codeBlock':
      return (
        <pre key={key}>
          <code>{nodeText(node)}</code>
        </pre>
      )
    case 'horizontalRule':
      return <hr key={key} />
    case 'image': {
      const assetId = typeof node.attrs?.assetId === 'string' ? node.attrs.assetId : ''
      const alt = typeof node.attrs?.alt === 'string' ? node.attrs.alt : ''
      const src = typeof node.attrs?.src === 'string' ? node.attrs.src : ''
      return <PreviewImage key={key} assetId={assetId} alt={alt} src={src} />
    }
    case 'table':
      return (
        <table key={key}>
          <tbody>{renderNodes(node.content, key)}</tbody>
        </table>
      )
    case 'tableRow':
      return <tr key={key}>{renderNodes(node.content, key)}</tr>
    case 'tableHeader':
      return <th key={key}>{renderNodes(node.content, key)}</th>
    case 'tableCell':
      return <td key={key}>{renderNodes(node.content, key)}</td>
    case 'hardBreak':
      return <br key={key} />
    case 'text':
      return renderText(node, key)
    default:
      return <span key={key}>{renderNodes(node.content, key)}</span>
  }
}

function renderNodes(nodes: TipTapNode[] | undefined, prefix: string): ReactNode {
  if (!nodes) return null
  return nodes.map((node, index) => renderNode(node, `${prefix}-${index}`))
}

function kindLabel(kind: string): string {
  if (kind === 'code') return '代码'
  if (kind === 'image') return '图片'
  return '文本'
}

export function BlockCardPreview({ blockId }: { blockId: string }) {
  const { session } = useServiceState()
  const block = session.blocks.find((candidate) => candidate.id === blockId)

  if (!block) {
    return (
      <div className="scratch-block-card">
        <div className="scratch-block-card__body scratch-block-card__empty">
          内容已从纸张中删除。
        </div>
      </div>
    )
  }

  const hasContent = nodeText(block.content.node).trim().length > 0 || block.kind === 'image'

  return (
    <div className="scratch-block-card" data-kind={block.kind}>
      <div className="scratch-block-card__label">
        <span>{kindLabel(block.kind)}</span>
        <span className="ml-auto normal-case tracking-normal text-faint/80">双击编辑</span>
      </div>
      <div className="scratch-block-card__body">
        {hasContent ? (
          renderNode(block.content.node, 'root')
        ) : (
          <span className="scratch-block-card__empty">空白卡片</span>
        )}
      </div>
    </div>
  )
}

export class BlockCardShapeUtil extends BaseBoxShapeUtil<BlockCardShape> {
  static override type = 'block-card' as const

  static override props: RecordProps<BlockCardShape> = {
    w: T.number,
    h: T.number,
    blockId: T.string,
  }

  override getDefaultProps(): BlockCardShape['props'] {
    return { w: DEFAULT_CARD_WIDTH, h: DEFAULT_CARD_HEIGHT, blockId: '' }
  }

  override component(shape: BlockCardShape) {
    return (
      <HTMLContainer>
        <BlockCardPreview blockId={shape.props.blockId} />
      </HTMLContainer>
    )
  }

  override getIndicatorPath(shape: BlockCardShape) {
    const path = new Path2D()
    path.rect(0, 0, shape.props.w, shape.props.h)
    return path
  }

  override onDoubleClick(shape: BlockCardShape) {
    window.dispatchEvent(
      new CustomEvent(EDIT_CARD_EVENT, {
        detail: { shapeId: shape.id, blockId: shape.props.blockId },
      }),
    )
  }
}
