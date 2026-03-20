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

export default function TranscriptViewer() {
  const [text, setText] = useState(() => localStorage.getItem('transcript-text') ?? DEFAULT_TEXT)
  const [windowSize, setWindowSize] = useState(20)
  const [durationInput, setDurationInput] = useState(() => localStorage.getItem('transcript-duration') ?? '30')
  const duration = Math.max(1, parseTimecode(durationInput) || 1)
  const [speed, setSpeed] = useState(1)
  const [position, setPosition] = useState(0)
  const [isPlaying, setIsPlaying] = useState(false)

  const rafRef = useRef<number | null>(null)
  const startTimeRef = useRef<number | null>(null)
  const startPositionRef = useRef(0)
  const wordRefsMap = useRef<Map<number, HTMLSpanElement>>(new Map())
  const textAreaRef = useRef<HTMLDivElement>(null)

  const words = text.trim() ? text.trim().split(/\s+/) : []
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

  // Auto-scroll cursor word into view
  useEffect(() => {
    if (words.length === 0) return
    const el = wordRefsMap.current.get(cursorIndex)
    if (el && textAreaRef.current) {
      el.scrollIntoView({ block: 'center', behavior: 'smooth' })
    }
  }, [cursorIndex, words.length])

  const handleScrubClick = useCallback((e: React.MouseEvent<HTMLDivElement>) => {
    const rect = e.currentTarget.getBoundingClientRect()
    const newPos = Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width))
    setPosition(newPos)
    stopPlayback()
  }, [stopPlayback])

  const handleScrubMouseMove = useCallback((e: React.MouseEvent<HTMLDivElement>) => {
    if (e.buttons !== 1) return
    const rect = e.currentTarget.getBoundingClientRect()
    const newPos = Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width))
    setPosition(newPos)
  }, [])

  return (
    <div className="transcript-page">
      <div className="controls-panel">
        <textarea
          className="paste-area"
          value={text}
          onChange={e => { setText(e.target.value); localStorage.setItem('transcript-text', e.target.value); setPosition(0); stopPlayback() }}
          placeholder="Paste transcript text here…"
          rows={3}
        />
        <div className="controls-row">
          <label>
            Window
            <input
              type="number"
              min={1}
              max={words.length || 1}
              value={windowSize}
              onChange={e => setWindowSize(Math.max(1, parseInt(e.target.value) || 1))}
            />
            words
          </label>
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
          <button className="play-btn" onClick={handlePlayPause}>
            {isPlaying ? '⏸ Pause' : position >= 1 ? '↺ Replay' : '▶ Play'}
          </button>
          <div className="speed-btns">
            {[1, 2, 5, 10].map(s => (
              <button
                key={s}
                className={`speed-btn${speed === s ? ' active' : ''}`}
                onClick={() => setSpeed(s)}
              >{s}x</button>
            ))}
          </div>
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
