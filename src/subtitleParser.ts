function decodeHtmlEntities(str: string): string {
  const doc = new DOMParser().parseFromString(str, 'text/html')
  return doc.documentElement.textContent ?? str
}

export interface SubtitleParseResult {
  text: string
  wordTimestamps: number[]  // seconds, one per word
  durationSecs: number
}

function formatVttTime(ms: number): string {
  const totalSecs = ms / 1000
  const h = Math.floor(totalSecs / 3600)
  const m = Math.floor((totalSecs % 3600) / 60)
  const s = totalSecs % 60
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:${s.toFixed(3).padStart(6, '0')}`
}

export function segmentsToVtt(segments: Array<{ text: string; offset: number; duration?: number }>): string {
  const lines = ['WEBVTT', '']
  for (let i = 0; i < segments.length; i++) {
    const seg = segments[i]
    const start = seg.offset
    const end = seg.duration != null
      ? start + seg.duration
      : (segments[i + 1]?.offset ?? start + 2000)
    lines.push(`${formatVttTime(start)} --> ${formatVttTime(end)}`)
    lines.push(decodeHtmlEntities(seg.text.trim()))
    lines.push('')
  }
  return lines.join('\n')
}

export function buildTranscriptData(
  segments: Array<{ text: string; offset: number }>
): { text: string; wordTimestamps: number[] } {
  const words: string[] = []
  const timestamps: number[] = []
  for (const seg of segments) {
    const segWords = decodeHtmlEntities(seg.text.trim()).split(/\s+/).filter(Boolean)
    for (const w of segWords) {
      words.push(w)
      timestamps.push(seg.offset)
    }
  }
  return { text: words.join(' '), wordTimestamps: timestamps }
}

interface Cue {
  startMs: number
  endMs: number
  text: string
}

function parseTimestampMs(ts: string): number {
  // Supports HH:MM:SS.mmm or MM:SS.mmm (VTT uses '.', SRT uses ',')
  const normalized = ts.trim().replace(',', '.')
  const parts = normalized.split(':').map(Number)
  if (parts.length === 3) {
    return Math.round((parts[0] * 3600 + parts[1] * 60 + parts[2]) * 1000)
  }
  if (parts.length === 2) {
    return Math.round((parts[0] * 60 + parts[1]) * 1000)
  }
  return 0
}

function parseCues(raw: string): Cue[] {
  const cues: Cue[] = []
  // Split into blocks by blank lines
  const blocks = raw.split(/\n\s*\n/)
  for (const block of blocks) {
    const lines = block.trim().split('\n').map(l => l.trim()).filter(Boolean)
    if (lines.length < 2) continue
    // Find the timestamp line (contains ' --> ')
    let tsLineIdx = -1
    for (let i = 0; i < lines.length; i++) {
      if (lines[i].includes(' --> ')) { tsLineIdx = i; break }
    }
    if (tsLineIdx === -1) continue
    const tsParts = lines[tsLineIdx].split(' --> ')
    if (tsParts.length < 2) continue
    const startMs = parseTimestampMs(tsParts[0].trim())
    // End timestamp may have extra metadata (VTT position info), take only first token
    const endMs = parseTimestampMs(tsParts[1].trim().split(/\s/)[0])
    // Text lines are after the timestamp line
    const textLines = lines.slice(tsLineIdx + 1)
    const text = textLines.join(' ').replace(/<[^>]+>/g, '').trim()
    if (text) {
      cues.push({ startMs, endMs, text })
    }
  }
  return cues
}

function cuesIntoResult(cues: Cue[]): SubtitleParseResult | null {
  if (cues.length === 0) return null
  const words: string[] = []
  const timestamps: number[] = []
  for (const cue of cues) {
    const cueWords = cue.text.split(/\s+/).filter(Boolean)
    for (const w of cueWords) {
      words.push(w)
      timestamps.push(cue.startMs / 1000)
    }
  }
  if (words.length === 0) return null
  const durationSecs = Math.ceil(Math.max(...cues.map(c => c.endMs)) / 1000)
  return { text: words.join(' '), wordTimestamps: timestamps, durationSecs }
}

export function parseSubtitleFile(raw: string): SubtitleParseResult | null {
  try {
    const cues = parseCues(raw)
    return cuesIntoResult(cues)
  } catch {
    return null
  }
}

export function detectAndParseSubtitle(raw: string): SubtitleParseResult | null {
  const lines = raw.split('\n').map(l => l.trim()).filter(Boolean)
  if (lines.length < 2) return null

  const firstLine = lines[0].replace(/^\uFEFF/, '')

  // VTT detection
  if (firstLine.startsWith('WEBVTT')) {
    return parseSubtitleFile(raw)
  }

  // SRT detection: first non-blank line is a number, second contains ' --> '
  if (/^\d+$/.test(firstLine) && lines[1].includes(' --> ')) {
    return parseSubtitleFile(raw)
  }

  return null
}
