import { describe, expect, it } from 'vitest'
import {
  looksLikeMarkdown,
  markdownToHtml,
  shouldConvertMarkdownClipboard,
} from '@/features/paper/markdown-paste'

describe('Markdown paste detection', () => {
  it('recognizes common Markdown structures', () => {
    expect(looksLikeMarkdown('# 标题\n\n正文')).toBe(true)
    expect(looksLikeMarkdown('- 一\n- 二')).toBe(true)
    expect(looksLikeMarkdown('1. 一\n2. 二')).toBe(true)
    expect(looksLikeMarkdown('> 引用')).toBe(true)
    expect(looksLikeMarkdown('| A | B |\n| --- | --- |\n| 1 | 2 |')).toBe(true)
    expect(looksLikeMarkdown('Title\n=====\n\n正文')).toBe(true)
    expect(looksLikeMarkdown('![图](https://example.com/a.png)')).toBe(true)
    expect(looksLikeMarkdown('普通的一段文字，没有格式。')).toBe(false)
  })

  it('converts when the clipboard also carries a plain HTML wrapper', () => {
    const markdown = '# 标题\n\n- 项目'
    expect(shouldConvertMarkdownClipboard(markdown, '')).toBe(true)
    expect(shouldConvertMarkdownClipboard(markdown, `<pre>${markdown}</pre>`)).toBe(true)
    expect(
      shouldConvertMarkdownClipboard(markdown, `<div data-foo="bar">${markdown}</div>`),
    ).toBe(true)
  })

  it('keeps real rich HTML from being reparsed as Markdown', () => {
    const markdown = '# 标题\n\n正文'
    expect(
      shouldConvertMarkdownClipboard(
        markdown,
        '<h1>标题</h1><p>正文</p><ul><li>列表</li></ul>',
      ),
    ).toBe(false)
    expect(shouldConvertMarkdownClipboard('普通文字', '<p>普通文字</p>')).toBe(false)
  })
})

describe('Markdown to Tiptap HTML', () => {
  it('converts tables, task lists and headings', () => {
    const html = markdownToHtml(
      '# 标题\n\n| A | B |\n| --- | --- |\n| 1 | 2 |\n\n- [x] 完成\n- [ ] 待办',
    )
    expect(html).toContain('<h1>标题</h1>')
    expect(html).toContain('<table>')
    expect(html).toContain('<th>A</th>')
    expect(html).toContain('data-type="taskList"')
    expect(html).toContain('data-type="taskItem"')
    expect(html).toContain('data-checked="true"')
    expect(html).toContain('data-checked="false"')
  })

  it('keeps image sources for the editor node view', () => {
    const html = markdownToHtml('![alt](https://example.com/a.png)')
    expect(html).toContain('<img')
    expect(html).toContain('src="https://example.com/a.png"')
  })
})
