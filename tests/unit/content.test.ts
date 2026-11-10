import { describe, expect, it } from 'vitest'
import {
  collectAssetIds,
  docToPlainText,
  isNodeMeaningful,
  nodeKind,
  nodesToMarkdown,
  titleCandidateFromDoc,
} from '@/core/content'
import type { TipTapNode } from '@/core/models/types'

function paragraph(text?: string, blockId = 'block-1'): TipTapNode {
  return {
    type: 'paragraph',
    attrs: { blockId },
    content: text ? [{ type: 'text', text }] : [],
  }
}

function doc(...nodes: TipTapNode[]): TipTapNode {
  return { type: 'doc', content: nodes }
}

describe('content model helpers', () => {
  it('treats empty trailing paragraphs as non-blocks but keeps real content', () => {
    expect(isNodeMeaningful(paragraph())).toBe(false)
    expect(isNodeMeaningful(paragraph('   '))).toBe(false)
    expect(isNodeMeaningful(paragraph('你好'))).toBe(true)
    expect(isNodeMeaningful({ type: 'horizontalRule', attrs: { blockId: 'hr' } })).toBe(true)
    expect(
      isNodeMeaningful({ type: 'image', attrs: { blockId: 'img', assetId: 'asset-1' } }),
    ).toBe(true)
    expect(isNodeMeaningful({ type: 'image', attrs: { blockId: 'img' } })).toBe(false)
  })

  it('derives block kind from the top-level node type', () => {
    expect(nodeKind(paragraph('x'))).toBe('richtext')
    expect(nodeKind({ type: 'codeBlock' })).toBe('code')
    expect(nodeKind({ type: 'image', attrs: { assetId: 'a' } })).toBe('image')
  })

  it('derives a title candidate from the first non-empty block', () => {
    const document = doc(paragraph(), {
      type: 'heading',
      attrs: { level: 1, blockId: 'h1' },
      content: [{ type: 'text', text: '  周末清单  ' }],
    })
    expect(titleCandidateFromDoc(document)).toBe('周末清单')
    expect(titleCandidateFromDoc(doc(paragraph()))).toBe('')
  })

  it('flattens document text for search and previews', () => {
    const document = doc(
      paragraph('第一段'),
      {
        type: 'bulletList',
        attrs: { blockId: 'list' },
        content: [
          {
            type: 'listItem',
            content: [paragraph('条目一', 'li-1')],
          },
          {
            type: 'listItem',
            content: [paragraph('条目二', 'li-2')],
          },
        ],
      },
    )
    const text = docToPlainText(document)
    expect(text).toContain('第一段')
    expect(text).toContain('条目一')
    expect(text).toContain('条目二')
  })

  it('exports markdown with headings, lists, code, links and asset references', () => {
    const document = doc(
      {
        type: 'heading',
        attrs: { level: 2, blockId: 'h' },
        content: [{ type: 'text', text: '小节' }],
      },
      {
        type: 'paragraph',
        attrs: { blockId: 'p' },
        content: [
          { type: 'text', text: '加粗', marks: [{ type: 'bold' }] },
          { type: 'text', text: ' 和 ' },
          {
            type: 'text',
            text: '链接',
            marks: [{ type: 'link', attrs: { href: 'https://example.com' } }],
          },
        ],
      },
      {
        type: 'bulletList',
        attrs: { blockId: 'ul' },
        content: [
          {
            type: 'listItem',
            content: [paragraph('项目', 'li')],
          },
        ],
      },
      {
        type: 'codeBlock',
        attrs: { blockId: 'code', language: 'ts' },
        content: [{ type: 'text', text: 'const a = 1' }],
      },
      {
        type: 'image',
        attrs: { blockId: 'img', assetId: 'asset-1', alt: '示意图' },
      },
    )
    const markdown = nodesToMarkdown(document.content ?? [], '标题')
    expect(markdown).toContain('# 标题')
    expect(markdown).toContain('## 小节')
    expect(markdown).toContain('**加粗**')
    expect(markdown).toContain('[链接](https://example.com)')
    expect(markdown).toContain('- 项目')
    expect(markdown).toContain('```ts')
    expect(markdown).toContain('```')
    expect(markdown).toContain('![示意图](scratch-asset:asset-1)')
  })

  it('collects image asset ids recursively', () => {
    const ids = new Set<string>()
    collectAssetIds(
      {
        type: 'blockquote',
        content: [
          {
            type: 'paragraph',
            content: [{ type: 'image', attrs: { assetId: 'a1' } }],
          },
          { type: 'image', attrs: { assetId: 'a2' } },
        ],
      },
      ids,
    )
    expect([...ids].sort()).toEqual(['a1', 'a2'])
  })
})
