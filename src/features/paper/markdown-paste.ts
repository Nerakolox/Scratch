import { marked } from 'marked'

const MARKDOWN_PATTERNS = [
  /^\s{0,3}#{1,6}\s+\S/m,
  /^\s{0,3}(?:[-*+]|\d+[.)])\s+\S/m,
  /^\s{0,3}>\s?/m,
  /^\s*```/m,
  /^\s*\|.+\|\s*$/m,
  /^\s*([-*_])\s*(?:\1\s*){2,}$/m,
  /^\s*=+\s*$/m,
  /!\[[^\]]*\]\([^)]+\)/,
  /\[[^\]]+\]\([^)]+\)/,
  /\*\*[^*\n]+\*\*/,
  /`[^`\n]+`/,
  /<([a-z][\w-]*)(\s[^>]*)?>/i,
]

function normalize(text: string): string {
  return text.replace(/\r\n/g, '\n').trim()
}

/** Detect Markdown source rather than prose that merely contains dashes. */
export function looksLikeMarkdown(text: string): boolean {
  return MARKDOWN_PATTERNS.some((pattern) => pattern.test(text))
}

/**
 * Decide whether a clipboard payload should be parsed as Markdown.
 *
 * Many apps (chat UIs, editors) put the Markdown source in text/plain but also
 * attach a text/html wrapper such as `<pre>…</pre>`. In that case the HTML
 * text equals the plain text, and parsing Markdown is the right move.
 * Rich copied documents with real HTML structure should keep the default HTML
 * paste behavior.
 */
export function shouldConvertMarkdownClipboard(text: string, html: string): boolean {
  if (!text || !looksLikeMarkdown(text)) return false
  if (!html.trim()) return true
  if (typeof DOMParser === 'undefined') return false
  try {
    const document = new DOMParser().parseFromString(html, 'text/html')
    const htmlText = normalize(document.body.textContent ?? '')
    if (htmlText === normalize(text)) return true
    const richSelector = 'h1,h2,h3,h4,h5,h6,ul,ol,blockquote,table,strong,em,a'
    return !document.body.querySelector(richSelector)
  } catch {
    return false
  }
}

export function markdownToHtml(text: string): string {
  const raw = marked.parse(text, { async: false, gfm: true, breaks: false }) as string
  if (typeof DOMParser === 'undefined') return raw
  const document = new DOMParser().parseFromString(raw, 'text/html')

  // GFM task lists: marked emits a checkbox inside <li>; convert it to the
  // data attributes Tiptap's TaskList/TaskItem understand.
  for (const checkbox of Array.from(
    document.querySelectorAll<HTMLInputElement>('li > input[type="checkbox"]'),
  )) {
    const item = checkbox.parentElement
    const list = item?.parentElement
    if (!item || !list || list.tagName !== 'UL') continue
    list.setAttribute('data-type', 'taskList')
    for (const child of Array.from(list.children)) {
      if (child.tagName !== 'LI') continue
      child.setAttribute('data-type', 'taskItem')
      const box = child.querySelector<HTMLInputElement>('input[type="checkbox"]')
      child.setAttribute('data-checked', box?.hasAttribute('checked') ? 'true' : 'false')
      box?.remove()
    }
  }

  return document.body.innerHTML
}
