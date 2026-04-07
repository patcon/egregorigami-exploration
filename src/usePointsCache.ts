import { useEffect, useRef } from 'react'

const PREFIX = 'yt-3d-points-'

// Legacy hook used by v3/v5 views — saves/loads plain [x,y,z][] arrays
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
      const pts = JSON.parse(raw)
      const arr = Array.isArray(pts) ? pts : pts?.points
      if (Array.isArray(arr) && arr.length > 0) {
        restoredRef.current = videoId
        restorePoints(arr)
      }
    } catch { /* ignore malformed */ }
  }, [videoId, restorePoints, enabled])

  function restoreIfCached(): boolean {
    if (!videoId) return false
    const raw = localStorage.getItem(`${PREFIX}${videoId}`)
    if (!raw) return false
    try {
      const pts = JSON.parse(raw)
      const arr = Array.isArray(pts) ? pts : pts?.points
      if (Array.isArray(arr) && arr.length > 0) {
        restoredRef.current = videoId
        restorePoints(arr)
        return true
      }
    } catch { /* ignore malformed */ }
    return false
  }

  return {
    savePoints(pts: [number, number, number][]) {
      if (!videoId) return
      try { localStorage.setItem(`${PREFIX}${videoId}`, JSON.stringify(pts)) }
      catch { /* quota exceeded */ }
    },
    restoreIfCached,
  }
}

export interface CachedEmbedding {
  points: [number, number, number][]
  modelId: string
  segmentCount: number
}

export function loadCached(videoId: string): CachedEmbedding | null {
  const raw = localStorage.getItem(`${PREFIX}${videoId}`)
  if (!raw) return null
  try {
    const parsed = JSON.parse(raw)
    // Legacy format: raw array without metadata — treat as cache miss
    if (Array.isArray(parsed)) return null
    if (parsed && Array.isArray(parsed.points) && parsed.points.length > 0) {
      return parsed as CachedEmbedding
    }
  } catch { /* ignore malformed */ }
  return null
}

export function saveCached(videoId: string, data: CachedEmbedding): void {
  try {
    localStorage.setItem(`${PREFIX}${videoId}`, JSON.stringify(data))
  } catch { /* quota exceeded */ }
}
