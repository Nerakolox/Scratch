import type { ReactNode } from 'react'
import clsx from 'clsx'

/**
 * The single global header used by every non-canvas screen. Global actions
 * (sidebar toggle, document mode, search, settings) live here exactly once;
 * the sidebar is reserved for navigation.
 */
export function AppHeader({
  children,
  className,
}: {
  children: ReactNode
  className?: string
}) {
  return (
    <header
      className={clsx(
        'flex h-12 shrink-0 items-center gap-2 rounded-panel bg-surface px-2 shadow-panel',
        className,
      )}
    >
      {children}
    </header>
  )
}
