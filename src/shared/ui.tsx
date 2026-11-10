import type { ButtonHTMLAttributes, ReactNode } from 'react'
import { useEffect, useId, useLayoutEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import clsx from 'clsx'
import { Loader2, X } from 'lucide-react'

type ButtonVariant = 'primary' | 'secondary' | 'ghost' | 'danger'
type ButtonSize = 'sm' | 'md'

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant
  size?: ButtonSize
  loading?: boolean
  icon?: ReactNode
}

const VARIANTS: Record<ButtonVariant, string> = {
  primary:
    'bg-accent text-accent-ink border border-transparent hover:opacity-90 active:opacity-80 shadow-sm',
  secondary:
    'bg-surface text-ink border border-line hover:border-line-strong hover:bg-sunken/60 active:bg-sunken',
  ghost: 'bg-transparent text-muted border border-transparent hover:bg-sunken hover:text-ink',
  danger: 'bg-danger text-white border border-transparent hover:opacity-90 active:opacity-80',
}

const SIZES: Record<ButtonSize, string> = {
  sm: 'h-7 px-2.5 text-[12.5px] gap-1.5 rounded-md',
  md: 'h-9 px-3.5 text-[13.5px] gap-2 rounded-lg',
}

export function Button({
  variant = 'secondary',
  size = 'md',
  loading = false,
  icon,
  className,
  children,
  disabled,
  type = 'button',
  ...rest
}: ButtonProps) {
  return (
    <button
      type={type}
      disabled={disabled || loading}
      className={clsx(
        'inline-flex select-none items-center justify-center whitespace-nowrap font-medium transition-[color,background-color,border-color,box-shadow,transform] duration-150 active:scale-[0.985] disabled:cursor-not-allowed disabled:opacity-50',
        VARIANTS[variant],
        SIZES[size],
        className,
      )}
      {...rest}
    >
      {loading ? <Loader2 size={15} className="animate-spin" aria-hidden /> : icon}
      {children}
    </button>
  )
}

export interface IconButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  label: string
  size?: 'sm' | 'md'
  active?: boolean
}

export function IconButton({
  label,
  size = 'md',
  active = false,
  className,
  children,
  type = 'button',
  ...rest
}: IconButtonProps) {
  return (
    <button
      type={type}
      aria-label={label}
      title={label}
      className={clsx(
        'inline-flex items-center justify-center rounded-md text-muted transition-[color,background-color,transform] duration-150 hover:bg-sunken hover:text-ink active:scale-[0.96] disabled:opacity-40',
        size === 'sm' ? 'h-7 w-7' : 'h-8 w-8',
        active && 'bg-sunken text-ink',
        className,
      )}
      {...rest}
    >
      {children}
    </button>
  )
}

export function SegmentedControl<T extends string>({
  value,
  options,
  onChange,
  ariaLabel,
}: {
  value: T
  options: Array<{ value: T; label: ReactNode; icon?: ReactNode }>
  onChange: (value: T) => void
  ariaLabel: string
}) {
  const containerRef = useRef<HTMLDivElement>(null)
  const [indicator, setIndicator] = useState({ left: 0, width: 0, ready: false })

  useLayoutEffect(() => {
    const container = containerRef.current
    if (!container) return
    const measure = () => {
      const active = container.querySelector<HTMLElement>('[data-active="true"]')
      if (!active) return
      setIndicator({ left: active.offsetLeft, width: active.offsetWidth, ready: true })
    }
    measure()
    if (typeof ResizeObserver === 'undefined') return
    const observer = new ResizeObserver(measure)
    observer.observe(container)
    return () => observer.disconnect()
  }, [value])

  return (
    <div
      ref={containerRef}
      role="tablist"
      aria-label={ariaLabel}
      className="relative inline-flex items-center rounded-lg border border-line bg-sunken/70 p-0.5"
    >
      <span
        aria-hidden
        className={clsx(
          'pointer-events-none absolute inset-y-0.5 left-0 rounded-md bg-surface shadow-sm',
          indicator.ready && 'transition-[transform,width] duration-300 ease-smooth',
        )}
        style={{ width: indicator.width, transform: `translateX(${indicator.left}px)` }}
      />
      {options.map((option) => {
        const active = option.value === value
        return (
          <button
            key={option.value}
            type="button"
            role="tab"
            aria-selected={active}
            data-active={active}
            onClick={() => onChange(option.value)}
            className={clsx(
              'relative z-10 inline-flex h-7 items-center gap-1.5 rounded-md px-3 text-[12.5px] font-medium transition-colors duration-200',
              active ? 'text-ink' : 'text-muted hover:text-ink',
            )}
          >
            {option.icon}
            {option.label}
          </button>
        )
      })}
    </div>
  )
}

export function Switch({
  checked,
  onChange,
  label,
  description,
  disabled = false,
}: {
  checked: boolean
  onChange: (checked: boolean) => void
  label: ReactNode
  description?: ReactNode
  disabled?: boolean
}) {
  return (
    <label className="flex cursor-pointer items-start gap-3 rounded-lg px-3 py-2.5 transition-colors hover:bg-sunken/60">
      <span className="relative mt-0.5 inline-flex h-5 w-9 shrink-0 items-center">
        <input
          type="checkbox"
          checked={checked}
          disabled={disabled}
          onChange={(event) => onChange(event.target.checked)}
          className="peer absolute inset-0 z-10 m-0 h-full w-full cursor-pointer opacity-0 disabled:cursor-not-allowed"
        />
        <span
          aria-hidden
          className="pointer-events-none h-5 w-9 rounded-full bg-line-strong transition-colors peer-checked:bg-accent peer-focus-visible:ring-2 peer-focus-visible:ring-accent/30 peer-disabled:opacity-50"
        />
        <span
          aria-hidden
          className="pointer-events-none absolute left-0.5 h-4 w-4 rounded-full bg-elevated shadow-sm transition-transform peer-checked:translate-x-4"
        />
      </span>
      <span className="min-w-0">
        <span className="block text-[12.5px] font-medium text-ink">{label}</span>
        {description && (
          <span className="block text-[11px] leading-relaxed text-faint">{description}</span>
        )}
      </span>
    </label>
  )
}

export function Kbd({ children }: { children: ReactNode }) {
  return (
    <kbd className="rounded border border-line bg-sunken px-1.5 py-0.5 font-sans text-[10.5px] font-medium text-faint">
      {children}
    </kbd>
  )
}

export function Spinner({ label = '加载中' }: { label?: string }) {
  return (
    <span role="status" className="inline-flex items-center gap-2 text-[13px] text-muted">
      <Loader2 size={16} className="animate-spin" aria-hidden />
      {label}
    </span>
  )
}

export function Dialog({
  open,
  onClose,
  title,
  description,
  children,
  footer,
  width = 'max-w-md',
}: {
  open: boolean
  onClose: () => void
  title: string
  description?: string
  children?: ReactNode
  footer?: ReactNode
  width?: string
}) {
  const titleId = useId()
  const panelRef = useRef<HTMLDivElement>(null)
  const closeRef = useRef(onClose)
  closeRef.current = onClose
  const [rendered, setRendered] = useState(open)
  const [shown, setShown] = useState(false)

  useEffect(() => {
    if (open) {
      setRendered(true)
      return
    }
    setShown(false)
    const timer = window.setTimeout(() => setRendered(false), 160)
    return () => window.clearTimeout(timer)
  }, [open])

  // Wait for the closed-state commit, then flip to open on the next frame so
  // the browser has a starting opacity/transform to transition from.
  useEffect(() => {
    if (!open || !rendered) return
    const frame = requestAnimationFrame(() => setShown(true))
    return () => cancelAnimationFrame(frame)
  }, [open, rendered])

  useEffect(() => {
    if (!open || !rendered) return
    const previous = document.activeElement as HTMLElement | null
    const frame = requestAnimationFrame(() => panelRef.current?.focus())
    function handleKey(event: KeyboardEvent) {
      if (event.key === 'Escape') {
        event.stopPropagation()
        closeRef.current()
      }
      if (event.key === 'Tab' && panelRef.current) {
        const focusables = panelRef.current.querySelectorAll<HTMLElement>(
          'button:not([disabled]), [href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])',
        )
        if (focusables.length === 0) return
        const first = focusables[0]
        const last = focusables[focusables.length - 1]
        if (event.shiftKey && document.activeElement === first) {
          event.preventDefault()
          last.focus()
        } else if (!event.shiftKey && document.activeElement === last) {
          event.preventDefault()
          first.focus()
        }
      }
    }
    document.addEventListener('keydown', handleKey)
    return () => {
      cancelAnimationFrame(frame)
      document.removeEventListener('keydown', handleKey)
      previous?.focus?.()
    }
  }, [open, rendered])

  if (!rendered) return null
  return createPortal(
    <div
      className={clsx(
        'fixed inset-0 z-[100] flex items-center justify-center p-4 transition-opacity duration-150 ease-standard',
        shown ? 'opacity-100' : 'opacity-0',
      )}
    >
      <div
        className="absolute inset-0 bg-black/30 backdrop-blur-[2px]"
        onClick={onClose}
        aria-hidden
      />
      <div
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        tabIndex={-1}
        className={clsx(
          'relative flex w-full flex-col rounded-xl border border-line bg-elevated shadow-xl outline-none transition-[opacity,transform,translate,scale] duration-200 ease-smooth',
          shown ? 'translate-y-0 scale-100 opacity-100' : 'translate-y-1.5 scale-[0.985] opacity-0',
          width,
        )}
      >
        <div className="flex items-start justify-between gap-4 px-5 pt-5">
          <div>
            <h2 id={titleId} className="text-[15px] font-semibold text-ink">
              {title}
            </h2>
            {description && <p className="mt-1 text-[12.5px] leading-relaxed text-muted">{description}</p>}
          </div>
          <IconButton label="关闭" size="sm" onClick={onClose} className="-mr-1 -mt-1">
            <X size={15} />
          </IconButton>
        </div>
        {children && <div className="px-5 py-4 text-[13.5px] text-ink">{children}</div>}
        {footer && <div className="flex justify-end gap-2 rounded-b-xl bg-sunken/40 px-5 py-3.5">{footer}</div>}
      </div>
    </div>,
    document.body,
  )
}

export function Field({
  label,
  hint,
  children,
}: {
  label: string
  hint?: string
  children: ReactNode
}) {
  const id = useId()
  return (
    <div className="space-y-1.5">
      <label htmlFor={id} className="block text-[12.5px] font-medium text-ink">
        {label}
      </label>
      {children}
      {hint && <p className="text-[11.5px] leading-relaxed text-faint">{hint}</p>}
    </div>
  )
}

export const inputClass =
  'h-9 w-full rounded-lg border border-line bg-surface px-3 text-[13.5px] text-ink placeholder:text-faint focus:border-accent focus:outline-none focus-visible:ring-2 focus-visible:ring-accent/25'
