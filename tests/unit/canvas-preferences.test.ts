import { beforeEach, describe, expect, it } from 'vitest'
import {
  DEFAULT_CANVAS_PREFERENCES,
  readCanvasPreferences,
  writeCanvasPreferences,
} from '@/features/canvas/canvas-preferences'

describe('canvas preferences', () => {
  beforeEach(() => {
    localStorage.clear()
  })

  it('returns defaults when nothing is stored', () => {
    expect(readCanvasPreferences()).toEqual(DEFAULT_CANVAS_PREFERENCES)
    expect(readCanvasPreferences().alwaysSnap).toBe(true)
  })

  it('round-trips boolean preferences', () => {
    writeCanvasPreferences({
      showMinimap: true,
      showStylePanel: true,
      showCanvasMenu: true,
      alwaysSnap: false,
      showGrid: true,
    })
    expect(readCanvasPreferences()).toEqual({
      showMinimap: true,
      showStylePanel: true,
      showCanvasMenu: true,
      alwaysSnap: false,
      showGrid: true,
    })
  })

  it('ignores corrupt or wrongly typed values', () => {
    localStorage.setItem('scratch:canvasPreferences', '{not json')
    expect(readCanvasPreferences()).toEqual(DEFAULT_CANVAS_PREFERENCES)

    localStorage.setItem(
      'scratch:canvasPreferences',
      JSON.stringify({ showMinimap: 'yes', showGrid: true }),
    )
    const preferences = readCanvasPreferences()
    expect(preferences.showMinimap).toBe(DEFAULT_CANVAS_PREFERENCES.showMinimap)
    expect(preferences.showGrid).toBe(true)
  })
})
