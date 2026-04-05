export function extractVideoId(url: string): string | null {
  const valid = (id: string | null): string | null =>
    id && /^[a-zA-Z0-9_-]{11}$/.test(id) ? id : null
  try {
    const u = new URL(url.trim())
    if (u.hostname === 'youtu.be') return valid(u.pathname.slice(1))
    if (u.hostname.includes('youtube.com')) return valid(u.searchParams.get('v'))
    return null
  } catch {
    return /^[a-zA-Z0-9_-]{11}$/.test(url.trim()) ? url.trim() : null
  }
}

export function computeChunks(text: string, windowSize: number, overlapPct: number): string[] {
  const words = text.trim().split(/\s+/).filter(Boolean)
  if (words.length === 0) return []
  const step = Math.max(1, Math.round(windowSize * (1 - overlapPct / 100)))
  const chunks: string[] = []
  // Start at windowSize-1 so the first chunk is a full window (no clamping duplicates)
  for (let cursor = Math.min(windowSize - 1, words.length - 1); cursor < words.length; cursor += step) {
    const windowStart = Math.max(0, cursor - windowSize + 1)
    chunks.push(words.slice(windowStart, windowStart + windowSize).join(' '))
  }
  return chunks
}

export function computeExternalPosition(
  videoTime: number,
  wordTimestamps: number[] | null,
  totalSecs: number | null,
): number | undefined {
  if (!totalSecs) return undefined
  if (wordTimestamps && wordTimestamps.length > 1) {
    if (videoTime < wordTimestamps[0]) return 0
    // Find first word index of the current segment (last segment whose offset <= videoTime)
    let segFirstIdx = 0
    for (let i = 1; i < wordTimestamps.length; i++) {
      if (wordTimestamps[i] > videoTime) break
      if (wordTimestamps[i] > wordTimestamps[i - 1]) segFirstIdx = i
    }
    // Find last word index of this segment
    let segLastIdx = segFirstIdx
    while (segLastIdx + 1 < wordTimestamps.length && wordTimestamps[segLastIdx + 1] === wordTimestamps[segFirstIdx]) {
      segLastIdx++
    }
    // Interpolate within the segment using the next segment's start as the boundary
    const segStart = wordTimestamps[segFirstIdx]
    const nextSegStart = segLastIdx + 1 < wordTimestamps.length ? wordTimestamps[segLastIdx + 1] : totalSecs
    const segDuration = nextSegStart - segStart
    const segWordCount = segLastIdx - segFirstIdx + 1
    const wordOffset = segDuration > 0
      ? Math.min(Math.floor(((videoTime - segStart) / segDuration) * segWordCount), segWordCount - 1)
      : 0
    return (segFirstIdx + wordOffset) / (wordTimestamps.length - 1)
  }
  return videoTime / totalSecs
}
