import type { ReactNode } from 'react'
import type { Editor } from '@tiptap/react'
import {
  Code2,
  Heading1,
  Heading2,
  Heading3,
  Image as ImageIcon,
  List,
  ListChecks,
  ListOrdered,
  Minus,
  Quote,
  Table2,
} from 'lucide-react'

export interface SlashCommand {
  id: string
  label: string
  hint: string
  keywords: string[]
  icon: ReactNode
  run: (context: { editor: Editor; onPickImage: () => void }) => void
}

export const SLASH_COMMANDS: SlashCommand[] = [
  {
    id: 'heading-1',
    label: '标题 1',
    hint: '大标题',
    keywords: ['h1', 'title', 'biaoti', 'heading'],
    icon: <Heading1 size={16} />,
    run: ({ editor }) => editor.chain().focus().setHeading({ level: 1 }).run(),
  },
  {
    id: 'heading-2',
    label: '标题 2',
    hint: '中标题',
    keywords: ['h2', 'heading'],
    icon: <Heading2 size={16} />,
    run: ({ editor }) => editor.chain().focus().setHeading({ level: 2 }).run(),
  },
  {
    id: 'heading-3',
    label: '标题 3',
    hint: '小标题',
    keywords: ['h3', 'heading'],
    icon: <Heading3 size={16} />,
    run: ({ editor }) => editor.chain().focus().setHeading({ level: 3 }).run(),
  },
  {
    id: 'bullet-list',
    label: '无序列表',
    hint: '项目符号',
    keywords: ['list', 'ul', 'bullet', 'liebiao'],
    icon: <List size={16} />,
    run: ({ editor }) => editor.chain().focus().toggleBulletList().run(),
  },
  {
    id: 'ordered-list',
    label: '有序列表',
    hint: '编号列表',
    keywords: ['list', 'ol', 'numbered', 'order'],
    icon: <ListOrdered size={16} />,
    run: ({ editor }) => editor.chain().focus().toggleOrderedList().run(),
  },
  {
    id: 'task-list',
    label: '待办列表',
    hint: '可勾选清单',
    keywords: ['todo', 'task', 'check', 'daiban'],
    icon: <ListChecks size={16} />,
    run: ({ editor }) => editor.chain().focus().toggleTaskList().run(),
  },
  {
    id: 'quote',
    label: '引用',
    hint: '引用段落',
    keywords: ['quote', 'blockquote', 'yinyong'],
    icon: <Quote size={16} />,
    run: ({ editor }) => editor.chain().focus().toggleBlockquote().run(),
  },
  {
    id: 'code-block',
    label: '代码块',
    hint: '带语法高亮',
    keywords: ['code', 'pre', 'daima'],
    icon: <Code2 size={16} />,
    run: ({ editor }) => editor.chain().focus().toggleCodeBlock().run(),
  },
  {
    id: 'divider',
    label: '分隔线',
    hint: '水平分割',
    keywords: ['hr', 'divider', 'line', 'fenge'],
    icon: <Minus size={16} />,
    run: ({ editor }) =>
      editor.chain().focus().setHorizontalRule().createParagraphNear().run(),
  },
  {
    id: 'table',
    label: '表格',
    hint: '3 × 3 表格',
    keywords: ['table', 'biaoge', 'grid'],
    icon: <Table2 size={16} />,
    run: ({ editor }) =>
      editor.chain().focus().insertTable({ rows: 3, cols: 3, withHeaderRow: true }).run(),
  },
  {
    id: 'image',
    label: '图片',
    hint: '从本地选择，图片存入本地数据库',
    keywords: ['image', 'picture', 'photo', 'tupian'],
    icon: <ImageIcon size={16} />,
    run: ({ onPickImage }) => onPickImage(),
  },
]

export function filterSlashCommands(query: string): SlashCommand[] {
  const normalized = query.trim().toLocaleLowerCase()
  if (!normalized) return SLASH_COMMANDS
  return SLASH_COMMANDS.filter(
    (command) =>
      command.label.toLocaleLowerCase().includes(normalized) ||
      command.keywords.some((keyword) => keyword.includes(normalized)),
  )
}
