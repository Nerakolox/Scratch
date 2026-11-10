import { X } from 'lucide-react'
import { Switch } from '@/shared/ui'
import {
  DEFAULT_CANVAS_PREFERENCES,
  type CanvasPreferences,
} from './canvas-preferences'

const ITEMS: Array<{
  key: keyof CanvasPreferences
  label: string
  hint: string
}> = [
  {
    key: 'alwaysSnap',
    label: '吸附与对齐线',
    hint: '拖动或缩放时显示对齐线并吸附；按住 ⌘/Ctrl 可临时关闭。',
  },
  {
    key: 'showGrid',
    label: '网格背景',
    hint: '显示点阵背景，并把拖动/缩放吸附到网格。',
  },
  {
    key: 'showMinimap',
    label: '小地图（缩略图）',
    hint: '显示整页卡片位置与当前视口的缩略图。',
  },
  {
    key: 'showStylePanel',
    label: '样式面板',
    hint: '选中箭头或图形时，显示颜色、线宽等 tldraw 样式。',
  },
  {
    key: 'showCanvasMenu',
    label: 'tldraw 菜单',
    hint: '显示页面菜单、主菜单和帮助入口。',
  },
]

export function CanvasSettingsPanel({
  preferences,
  onChange,
  onClose,
}: {
  preferences: CanvasPreferences
  onChange: (patch: Partial<CanvasPreferences>) => void
  onClose: () => void
}) {
  return (
    <div
      role="dialog"
      aria-label="画布设置"
      className="absolute right-0 top-full z-30 mt-2 w-72 max-w-[calc(100vw-24px)] rounded-xl border border-line/70 bg-elevated p-3 text-left shadow-panel motion-menu"
    >
      <div className="flex items-center justify-between gap-3 px-3 pb-1 pt-0.5">
        <h2 className="text-[12.5px] font-semibold text-ink">画布设置</h2>
        <button
          type="button"
          onClick={onClose}
          aria-label="关闭画布设置"
          className="rounded-md p-1 text-faint hover:bg-sunken hover:text-ink"
        >
          <X size={14} />
        </button>
      </div>
      <div className="mt-1 space-y-0.5">
        {ITEMS.map((item) => (
          <Switch
            key={item.key}
            checked={preferences[item.key]}
            onChange={(checked) => onChange({ [item.key]: checked })}
            label={item.label}
            description={item.hint}
          />
        ))}
      </div>
      <div className="mt-1 flex items-center justify-between gap-2 rounded-lg bg-sunken/50 px-3 py-1.5">
        <span className="text-[10.5px] text-faint">设置保存在本机</span>
        <button
          type="button"
          className="rounded-md px-1.5 py-0.5 text-[11.5px] text-muted hover:bg-sunken hover:text-ink"
          onClick={() => onChange({ ...DEFAULT_CANVAS_PREFERENCES })}
        >
          恢复默认
        </button>
      </div>
    </div>
  )
}
