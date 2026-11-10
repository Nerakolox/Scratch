export interface CanvasPreferences {
  showMinimap: boolean
  showStylePanel: boolean
  showCanvasMenu: boolean
  alwaysSnap: boolean
  showGrid: boolean
}

const STORAGE_KEY = 'scratch:canvasPreferences'

export const DEFAULT_CANVAS_PREFERENCES: CanvasPreferences = {
  showMinimap: false,
  showStylePanel: false,
  showCanvasMenu: false,
  // Alignment guides are the expected default for a spatial canvas; holding
  // Cmd/Ctrl temporarily disables snapping (tldraw's own convention).
  alwaysSnap: true,
  showGrid: false,
}

const BOOLEAN_KEYS: Array<keyof CanvasPreferences> = [
  'showMinimap',
  'showStylePanel',
  'showCanvasMenu',
  'alwaysSnap',
  'showGrid',
]

export function readCanvasPreferences(): CanvasPreferences {
  const fallback = { ...DEFAULT_CANVAS_PREFERENCES }
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (!raw) return fallback
    const parsed = JSON.parse(raw) as Record<string, unknown>
    for (const key of BOOLEAN_KEYS) {
      if (typeof parsed[key] === 'boolean') fallback[key] = parsed[key] as boolean
    }
    return fallback
  } catch {
    return fallback
  }
}

export function writeCanvasPreferences(preferences: CanvasPreferences): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(preferences))
  } catch {
    // Private mode: settings still apply to the current session.
  }
}
