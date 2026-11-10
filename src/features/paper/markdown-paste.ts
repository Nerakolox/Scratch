import { marked } from 'marked'

const MARKDOWN_PATTERNS = [
  /^#{1,6}\s+\S/m,
  /^[-*+]\s+\S/m,
  /^\d+\.\s+\S/m,
  /^>\s+\S/m,
  /```[\s\S]*?```/,
  /\[[^\]]+\]\([^)]+\)/,
  /\*\*[^*]+\*\*/,
  /`[^`]+`/,
]

/** Only convert when the clipboard really looks like Markdown source. */
export function looksLikeMarkdown(text: string): boolean {
  return MARKDOWN_PATTERNS.some((pattern) => pattern.test(text))
}

export function markdownToHtml(text: string): string {
  return marked.parse(text, { async: false, gfm: true, breaks: false }) as string
}
