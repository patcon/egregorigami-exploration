import { useState, useEffect, useRef, useCallback } from 'react'
import { detectAndParseSubtitle, type SubtitleParseResult } from './subtitleParser'

const DEFAULT_TEXT = `The embedding window is a concept from transformer models where a fixed-size context window moves through a sequence of tokens. As the window slides forward, the model attends to a new set of words, creating a representation of that local context. This visualization lets you see how the window advances through your text over time, simulating the way a transformer might process a long document or video transcript in chunks. Try pasting your own text, adjusting the window size to match your model's context length, and setting a playback duration to match the length of your source video or audio. Watch how the highlighted region moves steadily from the beginning to the end of the transcript, pausing and resuming as you explore.`

function parseTimecode(s: string): number {
  const parts = s.trim().split(':').map(Number)
  if (parts.some(isNaN)) return NaN
  if (parts.length === 1) return parts[0]
  if (parts.length === 2) return parts[0] * 60 + parts[1]
  return parts[0] * 3600 + parts[1] * 60 + parts[2]
}

interface TranscriptViewerProps {
  initialText?: string
  initialDuration?: string
  onWindowChange?: (params: { windowSize: number; overlapPct: number; text: string }) => void
  onParamsBlur?: () => void
  onCursorChange?: (wordIndex: number) => void
  onAllowFasterChange?: (allow: boolean) => void
  externalRawText?: string
  externalPosition?: number
  externalPlaying?: boolean
  onScrub?: (pos: number) => void
  onPlayingChange?: (playing: boolean) => void
  onSpeedChange?: (speed: number) => void
  maxSpeed?: number
  onSubtitleLoad?: (result: SubtitleParseResult) => void
}

export default function TranscriptViewer({ initialText, initialDuration, onWindowChange, onParamsBlur, onCursorChange, onAllowFasterChange, externalRawText, externalPosition, externalPlaying, onScrub, onPlayingChange, onSpeedChange, maxSpeed, onSubtitleLoad }: TranscriptViewerProps = {}) {
  const [rawText, setRawText] = useState(() => localStorage.getItem('transcript-raw-text') ?? initialText ?? DEFAULT_TEXT)
  const [text, setText] = useState(() => initialText ?? localStorage.getItem('transcript-text') ?? DEFAULT_TEXT)
  const [windowInput, setWindowInput] = useState(() => localStorage.getItem('transcript-window') ?? '40')
  const [windowMode, setWindowMode] = useState<'words' | 'segments'>(() => (localStorage.getItem('transcript-window-mode') as 'words' | 'segments') ?? 'words')
  const [overlapInput, setOverlapInput] = useState(() => localStorage.getItem('transcript-overlap') ?? '80')
  const [durationInput, setDurationInput] = useState(() => initialDuration ?? localStorage.getItem('transcript-duration') ?? '30')
  const duration = Math.max(1, parseTimecode(durationInput) || 1)
  const [speed, setSpeed] = useState(1)
  const [position, setPosition] = useState(0)
  const [isPlaying, setIsPlaying] = useState(false)
  const [autoScroll, setAutoScroll] = useState(() => localStorage.getItem('transcript-auto-scroll') !== 'false')
  const [allowFaster, setAllowFaster] = useState(() => localStorage.getItem('transcript-allow-faster') === 'true')

  const rafRef = useRef<number | null>(null)
  const startTimeRef = useRef<number | null>(null)
  const startPositionRef = useRef(0)
  const wordRefsMap = useRef<Map<number, HTMLSpanElement>>(new Map())
  const textAreaRef = useRef<HTMLDivElement>(null)
  const fileInputRef = useRef<HTMLInputElement>(null)

  const words = text.trim() ? text.trim().split(/\s+/) : []
  const overlapPct = Math.min(99, Math.max(0, parseFloat(overlapInput) || 0))
  const windowInputNum = parseInt(windowInput) || 0
  const windowSize = windowMode === 'words'
    ? Math.max(1, windowInputNum)
    : (words.length > 0 && windowInputNum > 0 ? Math.max(1, Math.round(words.length / windowInputNum)) : 1)
  const cursorIndex = Math.min(words.length - 1, Math.floor(position * (words.length - 1)))
  const windowStart = Math.max(0, cursorIndex - windowSize + 1)

  const stopPlayback = useCallback(() => {
    if (rafRef.current !== null) {
      cancelAnimationFrame(rafRef.current)
      rafRef.current = null
    }
    startTimeRef.current = null
    setIsPlaying(false)
  }, [])

  const tick = useCallback((timestamp: number) => {
    if (startTimeRef.current === null) {
      startTimeRef.current = timestamp
    }
    const elapsed = (timestamp - startTimeRef.current) / 1000
    const newPosition = Math.min(1, startPositionRef.current + (elapsed * speed) / duration)
    setPosition(newPosition)
    if (newPosition >= 1) {
      stopPlayback()
      return
    }
    rafRef.current = requestAnimationFrame(tick)
  }, [duration, speed, stopPlayback])

  const handlePlayPause = useCallback(() => {
    if (isPlaying) {
      stopPlayback()
    } else {
      startPositionRef.current = position >= 1 ? 0 : position
      if (position >= 1) setPosition(0)
      startTimeRef.current = null
      setIsPlaying(true)
      // When an external time source (e.g. YouTube player) is active, don't run
      // the internal RAF — externalPosition updates will drive the cursor instead.
      // Without this guard, the cursor drifts forward during pre-speech video intros
      // where externalPosition is stuck at 0 and never triggers its cancel-RAF effect.
      if (externalPlaying === undefined) {
        rafRef.current = requestAnimationFrame(tick)
      }
    }
  }, [isPlaying, position, externalPlaying, stopPlayback, tick])

  // Restart RAF when tick changes (duration changes while playing)
  useEffect(() => {
    if (isPlaying) {
      if (rafRef.current !== null) cancelAnimationFrame(rafRef.current)
      startPositionRef.current = position
      startTimeRef.current = null
      rafRef.current = requestAnimationFrame(tick)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tick])

  useEffect(() => {
    return () => {
      if (rafRef.current !== null) cancelAnimationFrame(rafRef.current)
    }
  }, [])

  useEffect(() => {
    if (externalRawText === undefined) return
    const normalized = externalRawText.replace(/\s+/g, ' ').trim()
    setRawText(externalRawText)
    setText(normalized)
    // Don't reset position — let playback continue over the growing text
  }, [externalRawText])

  useEffect(() => {
    if (externalPosition !== undefined) {
      setPosition(externalPosition)
      // Stop the internal RAF — the external time source (YouTube player) owns position now
      if (rafRef.current !== null) {
        cancelAnimationFrame(rafRef.current)
        rafRef.current = null
      }
      startPositionRef.current = externalPosition
      startTimeRef.current = null
    }
  }, [externalPosition])

  useEffect(() => {
    if (externalPlaying === undefined) return
    if (externalPlaying && !isPlaying) {
      startPositionRef.current = position >= 1 ? 0 : position
      if (position >= 1) setPosition(0)
      startTimeRef.current = null
      setIsPlaying(true)
      // Don't start internal RAF — externalPosition updates drive the cursor
      // when an external time source is active (same reasoning as handlePlayPause)
    } else if (!externalPlaying && isPlaying) {
      stopPlayback()
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [externalPlaying])

  useEffect(() => {
    onPlayingChange?.(isPlaying)
  // onPlayingChange intentionally omitted — callers should stabilize with useCallback/setState setter
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isPlaying])

  // Auto-scroll cursor word into view (only while playing and auto-scroll enabled)
  useEffect(() => {
    if (!isPlaying || !autoScroll || words.length === 0) return
    const el = wordRefsMap.current.get(cursorIndex)
    if (el && textAreaRef.current) {
      el.scrollIntoView({ block: 'center', behavior: 'smooth' })
    }
  }, [isPlaying, autoScroll, cursorIndex, words.length])

  const scrubRectRef = useRef<DOMRect | null>(null)

  const applyScrubPos = useCallback((clientX: number) => {
    if (!scrubRectRef.current) return
    const newPos = Math.max(0, Math.min(1, (clientX - scrubRectRef.current.left) / scrubRectRef.current.width))
    setPosition(newPos)
    onScrub?.(newPos)
  }, [onScrub])

  const handleScrubPointerDown = useCallback((e: React.PointerEvent<HTMLDivElement>) => {
    e.preventDefault()
    e.currentTarget.setPointerCapture(e.pointerId)
    scrubRectRef.current = e.currentTarget.getBoundingClientRect()
    stopPlayback()
    applyScrubPos(e.clientX)
  }, [stopPlayback, applyScrubPos])

  const handleScrubPointerMove = useCallback((e: React.PointerEvent<HTMLDivElement>) => {
    if (!e.currentTarget.hasPointerCapture(e.pointerId)) return
    applyScrubPos(e.clientX)
  }, [applyScrubPos])

  const handleStep = useCallback((dir: 1 | -1) => {
    stopPlayback()
    setPosition(prev => {
      const stepWords = Math.max(1, Math.round(windowSize * (1 - overlapPct / 100)))
      const stepFraction = stepWords / Math.max(1, words.length - 1)
      const newPos = Math.min(1, Math.max(0, prev + dir * stepFraction))
      onScrub?.(newPos)
      return newPos
    })
  }, [stopPlayback, windowSize, overlapPct, words.length, onScrub])

  const applySubtitleResult = useCallback((raw: string, parsed: SubtitleParseResult) => {
    setRawText(raw)
    setText(parsed.text)
    setDurationInput(String(parsed.durationSecs))
    localStorage.setItem('transcript-raw-text', raw)
    localStorage.setItem('transcript-text', parsed.text)
    localStorage.setItem('transcript-duration', String(parsed.durationSecs))
    setPosition(0)
    stopPlayback()
    onSubtitleLoad?.(parsed)
  }, [stopPlayback, onSubtitleLoad])

  const handleFileLoad = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (!file) return
    const reader = new FileReader()
    reader.onload = ev => {
      const raw = ev.target?.result as string
      const parsed = detectAndParseSubtitle(raw)
      if (parsed) {
        applySubtitleResult(raw, parsed)
      } else {
        const normalized = raw.replace(/\s+/g, ' ').trim()
        setRawText(raw)
        setText(normalized)
        localStorage.setItem('transcript-raw-text', raw)
        localStorage.setItem('transcript-text', normalized)
        setPosition(0)
        stopPlayback()
      }
    }
    reader.readAsText(file)
    // Reset so the same file can be re-selected
    e.target.value = ''
  }, [applySubtitleResult, stopPlayback])

  useEffect(() => {
    onWindowChange?.({ windowSize, overlapPct, text })
  // onWindowChange intentionally omitted — callers should stabilize with useCallback/useRef
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [windowSize, overlapPct, text])

  useEffect(() => {
    onCursorChange?.(cursorIndex)
  // onCursorChange intentionally omitted
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cursorIndex])

  // Global keyboard controls (only when no external video source is active)
  useEffect(() => {
    if (externalPlaying !== undefined) return
    const handler = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement
      if (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.isContentEditable) return
      if (e.key === ' ') {
        e.preventDefault()
        handlePlayPause()
      } else if (e.key === 'ArrowRight') {
        e.preventDefault()
        handleStep(1)
      } else if (e.key === 'ArrowLeft') {
        e.preventDefault()
        handleStep(-1)
      }
    }
    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [externalPlaying, handlePlayPause, handleStep])

  const inputBase = 'py-1 px-1.5 border border-border rounded bg-code-bg text-text-h text-sm text-center focus:outline-2 focus:outline-accent focus:outline-offset-[1px]'
  const inputError = 'border-[#e53e3e] outline-[#e53e3e]'

  return (
    <div className="flex flex-col flex-1 min-h-0 text-left">
      <div className="sticky top-0 bg-bg z-10 pt-3 px-5 border-b border-border flex flex-col gap-2">
        <div className="flex items-start gap-2">
          <textarea
            className="w-full box-border resize-y font-mono text-[13px] py-2 px-2.5 border border-border rounded-md bg-code-bg text-text-h leading-[1.5] focus:outline-2 focus:outline-accent focus:outline-offset-[1px]"
            value={rawText}
            onChange={e => {
              const raw = e.target.value
              const normalized = raw.replace(/\s+/g, ' ').trim()
              setRawText(raw)
              setText(normalized)
              localStorage.setItem('transcript-raw-text', raw)
              localStorage.setItem('transcript-text', normalized)
              setPosition(0)
              stopPlayback()
            }}
            onBlur={onParamsBlur}
            onPaste={e => {
              e.preventDefault()
              const raw = e.clipboardData.getData('text')
              const parsed = detectAndParseSubtitle(raw)
              if (parsed) {
                applySubtitleResult(raw, parsed)
              } else {
                const normalized = raw.replace(/\s+/g, ' ').trim()
                setRawText(raw)
                setText(normalized)
                localStorage.setItem('transcript-raw-text', raw)
                localStorage.setItem('transcript-text', normalized)
                setPosition(0)
                stopPlayback()
              }
            }}
            placeholder="Paste transcript text or .vtt/.srt here…"
            rows={3}
          />
          <button type="button" className="flex-shrink-0 py-1.5 px-3 bg-code-bg text-text-h border border-border rounded-md text-[13px] cursor-pointer whitespace-nowrap transition-opacity duration-150 hover:opacity-75"
            onClick={() => fileInputRef.current?.click()}>Load file</button>
          <input ref={fileInputRef} type="file" accept=".vtt,.srt,text/vtt,text/plain"
            className="hidden" onChange={handleFileLoad} />
        </div>
        <div className="flex items-center gap-4 flex-wrap">
          <div className="flex items-center gap-1.5 text-sm text-text">
            Window
            <input
              type="number"
              min={1}
              className={`w-16 ${inputBase} ${windowInputNum <= 0 ? inputError : ''}`}
              value={windowInput}
              onChange={e => { setWindowInput(e.target.value); localStorage.setItem('transcript-window', e.target.value) }}
              onBlur={onParamsBlur}
            />
            <label className="flex items-center gap-[3px] text-sm text-text cursor-pointer">
              <input type="radio" name="windowMode" value="words" checked={windowMode === 'words'} onChange={() => { setWindowMode('words'); localStorage.setItem('transcript-window-mode', 'words') }} />
              words
            </label>
            <label className="flex items-center gap-[3px] text-sm text-text cursor-pointer">
              <input type="radio" name="windowMode" value="segments" checked={windowMode === 'segments'} onChange={() => { setWindowMode('segments'); localStorage.setItem('transcript-window-mode', 'segments') }} />
              segments
            </label>
            {windowMode === 'segments' && windowInputNum > 0 && words.length > 0 && (
              <span className="text-[13px] text-text opacity-60">({windowSize} words)</span>
            )}
          </div>
          <label className="flex items-center gap-1.5 text-sm text-text">
            Duration
            <input
              type="text"
              className={`w-[72px] ${inputBase} ${parseTimecode(durationInput) > 0 ? '' : inputError}`}
              value={durationInput}
              onChange={e => { setDurationInput(e.target.value); localStorage.setItem('transcript-duration', e.target.value) }}
              placeholder="30 or 4:28"
            />
          </label>
          <label className="flex items-center gap-1.5 text-sm text-text">
            Overlap
            <input
              type="number"
              min={0}
              max={99}
              className={`w-[52px] ${inputBase} ${parseFloat(overlapInput) < 0 || parseFloat(overlapInput) >= 100 ? inputError : ''}`}
              value={overlapInput}
              onChange={e => { setOverlapInput(e.target.value); localStorage.setItem('transcript-overlap', e.target.value) }}
              onBlur={onParamsBlur}
            />
            %
          </label>
          <div className="flex items-center gap-1">
            <button className="py-1.5 px-2.5 bg-code-bg text-text-h border border-border rounded-md text-[13px] cursor-pointer transition-opacity duration-150 hover:opacity-75" onClick={() => handleStep(-1)} title="Step back">&#9664;</button>
            <button className="py-1.5 px-4 bg-accent text-white border-0 rounded-md text-sm cursor-pointer font-medium transition-opacity duration-150 hover:opacity-85" onClick={handlePlayPause}>
              {isPlaying ? '⏸ Pause' : position >= 1 ? '↺ Replay' : '▶ Play'}
            </button>
            <button className="py-1.5 px-2.5 bg-code-bg text-text-h border border-border rounded-md text-[13px] cursor-pointer transition-opacity duration-150 hover:opacity-75" onClick={() => handleStep(1)} title="Step forward">&#9654;</button>
          </div>
          <div className="flex gap-0.5">
            {[1, 2, 5, 10].map(s => (
              <button
                key={s}
                className={[
                  'py-1 px-2 text-[13px] border border-border cursor-pointer rounded-none first:rounded-l last:rounded-r disabled:opacity-35 disabled:cursor-not-allowed',
                  speed === s ? 'bg-accent border-accent text-white' : 'bg-code-bg text-text',
                ].join(' ')}
                onClick={() => { setSpeed(s); onSpeedChange?.(s) }}
                disabled={!allowFaster && maxSpeed !== undefined && s > maxSpeed}
                title={!allowFaster && maxSpeed !== undefined && s > maxSpeed ? `YouTube player is capped at ${maxSpeed}x` : undefined}
              >{s}x</button>
            ))}
            {maxSpeed !== undefined && (
              <label className="flex items-center gap-[3px] text-sm text-text cursor-pointer">
                <input
                  type="checkbox"
                  checked={allowFaster}
                  onChange={e => {
                    const checked = e.target.checked
                    setAllowFaster(checked)
                    localStorage.setItem('transcript-allow-faster', String(checked))
                    if (!checked && speed > maxSpeed) {
                      setSpeed(maxSpeed)
                      onSpeedChange?.(maxSpeed)
                    }
                    onAllowFasterChange?.(checked)
                  }}
                />
                allow faster
              </label>
            )}
          </div>
          <label className="flex items-center gap-[3px] text-sm text-text cursor-pointer ml-auto">
            <input type="checkbox" checked={autoScroll} onChange={e => { setAutoScroll(e.target.checked); localStorage.setItem('transcript-auto-scroll', String(e.target.checked)) }} />
            auto-scroll
          </label>
          <span className="text-[13px] text-text">{words.length} words</span>
        </div>
        <div
          className="scrub-bar relative h-[4px] bg-border cursor-pointer mt-2 rounded-[2px] overflow-visible group"
          onPointerDown={handleScrubPointerDown}
          onPointerMove={handleScrubPointerMove}
        >
          <div className="scrub-progress absolute left-0 top-0 h-full bg-accent rounded-[2px] pointer-events-none" style={{ width: `${position * 100}%` }} />
          <div className="scrub-thumb absolute top-1/2 -translate-x-1/2 -translate-y-1/2 w-3 h-3 bg-accent rounded-full pointer-events-none transition-transform duration-100" style={{ left: `${position * 100}%` }} />
        </div>
      </div>

      <div className="flex-1 overflow-y-auto py-6 px-5" ref={textAreaRef}>
        {words.length === 0 ? (
          <p className="text-text italic">Paste some text above to get started.</p>
        ) : (
          <p className="text-lg leading-[1.8] text-text">
            {words.map((word, i) => {
              const inWindow = i >= windowStart && i < windowStart + windowSize
              const isCursor = i === cursorIndex
              const cls = ['word', inWindow ? 'in-window' : '', isCursor ? 'cursor' : ''].filter(Boolean).join(' ')
              return (
                <span
                  key={i}
                  ref={el => {
                    if (el) wordRefsMap.current.set(i, el)
                    else wordRefsMap.current.delete(i)
                  }}
                  className={cls}
                >
                  {word}{' '}
                </span>
              )
            })}
          </p>
        )}
      </div>
    </div>
  )
}
