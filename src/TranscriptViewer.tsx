import { useState, useEffect, useRef, useCallback } from 'react'
import './TranscriptViewer.css'

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
  externalPosition?: number
  externalPlaying?: boolean
  onScrub?: (pos: number) => void
  onPlayingChange?: (playing: boolean) => void
  onSpeedChange?: (speed: number) => void
}

export default function TranscriptViewer({ initialText, initialDuration, onWindowChange, externalPosition, externalPlaying, onScrub, onPlayingChange, onSpeedChange }: TranscriptViewerProps = {}) {
  const [text, setText] = useState(() => initialText ?? localStorage.getItem('transcript-text') ?? DEFAULT_TEXT)
  const [windowInput, setWindowInput] = useState('20')
  const [windowMode, setWindowMode] = useState<'words' | 'segments'>('words')
  const [overlapInput, setOverlapInput] = useState('50')
  const [durationInput, setDurationInput] = useState(() => initialDuration ?? localStorage.getItem('transcript-duration') ?? '30')
  const duration = Math.max(1, parseTimecode(durationInput) || 1)
  const [speed, setSpeed] = useState(1)
  const [position, setPosition] = useState(0)
  const [isPlaying, setIsPlaying] = useState(false)
  const [autoScroll, setAutoScroll] = useState(true)

  const rafRef = useRef<number | null>(null)
  const startTimeRef = useRef<number | null>(null)
  const startPositionRef = useRef(0)
  const wordRefsMap = useRef<Map<number, HTMLSpanElement>>(new Map())
  const textAreaRef = useRef<HTMLDivElement>(null)

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
      rafRef.current = requestAnimationFrame(tick)
    }
  }, [isPlaying, position, stopPlayback, tick])

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
    if (externalPosition !== undefined) {
      setPosition(externalPosition)
      // Reset RAF baseline so the internal loop doesn't fight the external time source
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
      rafRef.current = requestAnimationFrame(tick)
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

  const handleScrubClick = useCallback((e: React.MouseEvent<HTMLDivElement>) => {
    const rect = e.currentTarget.getBoundingClientRect()
    const newPos = Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width))
    setPosition(newPos)
    onScrub?.(newPos)
    stopPlayback()
  }, [stopPlayback, onScrub])

  const handleScrubMouseMove = useCallback((e: React.MouseEvent<HTMLDivElement>) => {
    if (e.buttons !== 1) return
    const rect = e.currentTarget.getBoundingClientRect()
    const newPos = Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width))
    setPosition(newPos)
    onScrub?.(newPos)
  }, [onScrub])

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

  useEffect(() => {
    onWindowChange?.({ windowSize, overlapPct, text })
  // onWindowChange intentionally omitted — callers should stabilize with useCallback/useRef
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [windowSize, overlapPct, text])

  return (
    <div className="transcript-page">
      <div className="controls-panel">
        <textarea
          className="paste-area"
          value={text}
          onChange={e => { setText(e.target.value); localStorage.setItem('transcript-text', e.target.value); setPosition(0); stopPlayback() }}
          onPaste={e => {
            e.preventDefault()
            const normalized = e.clipboardData.getData('text').replace(/\s+/g, ' ').trim()
            setText(normalized)
            localStorage.setItem('transcript-text', normalized)
            setPosition(0)
            stopPlayback()
          }}
          placeholder="Paste transcript text here…"
          rows={3}
        />
        <div className="controls-row">
          <div className="controls-item">
            Window
            <input
              type="number"
              min={1}
              className={windowInputNum <= 0 ? 'input-error' : ''}
              value={windowInput}
              onChange={e => setWindowInput(e.target.value)}
              style={{ width: 64 }}
            />
            <label className="radio-label">
              <input type="radio" name="windowMode" value="words" checked={windowMode === 'words'} onChange={() => setWindowMode('words')} />
              words
            </label>
            <label className="radio-label">
              <input type="radio" name="windowMode" value="segments" checked={windowMode === 'segments'} onChange={() => setWindowMode('segments')} />
              segments
            </label>
            {windowMode === 'segments' && windowInputNum > 0 && words.length > 0 && (
              <span className="window-derived">({windowSize} words)</span>
            )}
          </div>
          <label>
            Duration
            <input
              type="text"
              className={parseTimecode(durationInput) > 0 ? '' : 'input-error'}
              value={durationInput}
              onChange={e => { setDurationInput(e.target.value); localStorage.setItem('transcript-duration', e.target.value) }}
              placeholder="30 or 4:28"
              style={{ width: 72 }}
            />
          </label>
          <label>
            Overlap
            <input
              type="number"
              min={0}
              max={99}
              className={parseFloat(overlapInput) < 0 || parseFloat(overlapInput) >= 100 ? 'input-error' : ''}
              value={overlapInput}
              onChange={e => setOverlapInput(e.target.value)}
              style={{ width: 52 }}
            />
            %
          </label>
          <div className="playback-btns">
            <button className="step-btn" onClick={() => handleStep(-1)} title="Step back">&#9664;</button>
            <button className="play-btn" onClick={handlePlayPause}>
              {isPlaying ? '⏸ Pause' : position >= 1 ? '↺ Replay' : '▶ Play'}
            </button>
            <button className="step-btn" onClick={() => handleStep(1)} title="Step forward">&#9654;</button>
          </div>
          <div className="speed-btns">
            {[1, 2, 5, 10].map(s => (
              <button
                key={s}
                className={`speed-btn${speed === s ? ' active' : ''}`}
                onClick={() => { setSpeed(s); onSpeedChange?.(s) }}
              >{s}x</button>
            ))}
          </div>
          <label className="radio-label" style={{ marginLeft: 'auto' }}>
            <input type="checkbox" checked={autoScroll} onChange={e => setAutoScroll(e.target.checked)} />
            auto-scroll
          </label>
          <span className="word-count">{words.length} words</span>
        </div>
        <div
          className="scrub-bar"
          onClick={handleScrubClick}
          onMouseMove={handleScrubMouseMove}
        >
          <div className="scrub-progress" style={{ width: `${position * 100}%` }} />
          <div className="scrub-thumb" style={{ left: `${position * 100}%` }} />
        </div>
      </div>

      <div className="text-area" ref={textAreaRef}>
        {words.length === 0 ? (
          <p className="placeholder">Paste some text above to get started.</p>
        ) : (
          <p className="word-list">
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
