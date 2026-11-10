import { create } from 'zustand'
import { CheckCircle2, Info, X, XCircle } from 'lucide-react'
import { newId } from '@/core/utils'

export type ToastTone = 'info' | 'success' | 'error'

export interface ToastItem {
  id: string
  message: string
  tone: ToastTone
}

interface ToastState {
  items: ToastItem[]
  push: (message: string, tone?: ToastTone) => void
  dismiss: (id: string) => void
}

export const useToastStore = create<ToastState>((set, get) => ({
  items: [],
  push: (message, tone = 'info') => {
    const id = newId()
    set({ items: [...get().items, { id, message, tone }] })
    window.setTimeout(() => {
      set({ items: get().items.filter((item) => item.id !== id) })
    }, 4200)
  },
  dismiss: (id) => set({ items: get().items.filter((item) => item.id !== id) }),
}))

export function toast(message: string, tone: ToastTone = 'info'): void {
  useToastStore.getState().push(message, tone)
}

export function Toaster() {
  const items = useToastStore((state) => state.items)
  const dismiss = useToastStore((state) => state.dismiss)
  if (items.length === 0) return null
  return (
    <div
      className="pointer-events-none fixed inset-x-0 bottom-5 z-[120] flex flex-col items-center gap-2 px-4"
      aria-live="polite"
      aria-atomic="false"
    >
      {items.map((item) => (
        <div
          key={item.id}
          className="pointer-events-auto flex max-w-md items-center gap-2.5 rounded-lg border border-line bg-elevated px-3.5 py-2.5 text-[13.5px] shadow-sm"
        >
          {item.tone === 'success' ? (
            <CheckCircle2 size={16} className="shrink-0 text-success" aria-hidden />
          ) : item.tone === 'error' ? (
            <XCircle size={16} className="shrink-0 text-danger" aria-hidden />
          ) : (
            <Info size={16} className="shrink-0 text-accent" aria-hidden />
          )}
          <span className="min-w-0 flex-1">{item.message}</span>
          <button
            type="button"
            className="rounded p-0.5 text-faint hover:bg-sunken hover:text-ink"
            onClick={() => dismiss(item.id)}
            aria-label="关闭通知"
          >
            <X size={14} />
          </button>
        </div>
      ))}
    </div>
  )
}
