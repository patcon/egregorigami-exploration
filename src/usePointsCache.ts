import { useEffect, useRef } from 'react'

const PREFIX = 'yt-3d-points-'

export function usePointsCache(
  videoId: string | null,
  restorePoints: (pts: [number, number, number][]) => void,
  enabled = true,
) {
  const restoredRef = useRef<string | null>(null)

  useEffect(() => {
    if (!enabled || !videoId || restoredRef.current === videoId) return
    const raw = localStorage.getItem(`${PREFIX}${videoId}`)
    if (!raw) return
    try {
      const pts = JSON.parse(raw) as [number, number, number][]
      if (Array.isArray(pts) && pts.length > 0) {
        restoredRef.current = videoId
        restorePoints(pts)
      }
    } catch { /* ignore malformed */ }
  }, [videoId, restorePoints, enabled])

  return {
    savePoints(pts: [number, number, number][]) {
      if (!videoId) return
      try { localStorage.setItem(`${PREFIX}${videoId}`, JSON.stringify(pts)) }
      catch { /* quota exceeded */ }
    }
  }
}
