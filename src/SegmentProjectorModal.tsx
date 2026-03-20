import { useEffect, useRef, useState, useCallback } from 'react'
import { getEmbeddings } from './embedSegments'
import { runUmap } from './runUmap'
import ScatterPlot3D from './ScatterPlot3D'
import './SegmentProjectorModal.css'

const PLAYBACK_DURATION = 10 // seconds to walk all segments

type Phase =
  | { status: 'idle' }
  | { status: 'model-loading'; progress: number }
  | { status: 'embedding'; loaded: number; total: number }
  | { status: 'umap-running' }
  | { status: 'done'; points: [number, number, number][] }
  | { status: 'error'; message: string }

interface Props {
  segments: string[]
  onClose: () => void
}

export default function SegmentProjectorModal({ segments, onClose }: Props) {
  const [phase, setPhase] = useState<Phase>({ status: 'idle' })
  const [highlightIndex, setHighlightIndex] = useState<number | null>(null)
  const [dotPosition, setDotPosition] = useState<number | null>(null) // float for smooth interpolation
  const [isPlaying, setIsPlaying] = useState(false)
  const listRef = useRef<HTMLUListElement>(null)
  const rafRef = useRef<number | null>(null)
  const startTimeRef = useRef<number | null>(null)
  const tickStartPosRef = useRef(0)

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose() }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  // Scroll highlighted list item into view
  useEffect(() => {
    if (highlightIndex === null || !listRef.current) return
    const item = listRef.current.children[highlightIndex] as HTMLLIElement | undefined
    item?.scrollIntoView({ block: 'nearest' })
  }, [highlightIndex])

  const stopPlayback = useCallback(() => {
    if (rafRef.current !== null) {
      cancelAnimationFrame(rafRef.current)
      rafRef.current = null
    }
    startTimeRef.current = null
    setIsPlaying(false)
  }, [])

  const tick = useCallback((timestamp: number) => {
    if (startTimeRef.current === null) startTimeRef.current = timestamp
    const elapsed = (timestamp - startTimeRef.current) / 1000
    const startPos = tickStartPosRef.current
    const endPos = segments.length - 1
    const speed = (endPos - startPos) / PLAYBACK_DURATION
    const floatPos = Math.min(endPos, startPos + elapsed * speed)
    setDotPosition(floatPos)
    setHighlightIndex(Math.round(floatPos))
    if (floatPos >= endPos) {
      stopPlayback()
      return
    }
    rafRef.current = requestAnimationFrame(tick)
  }, [segments.length, stopPlayback])

  const handlePlayPause = useCallback(() => {
    if (isPlaying) {
      stopPlayback()
    } else {
      const currentPos = dotPosition ?? 0
      const atEnd = currentPos >= segments.length - 1
      tickStartPosRef.current = atEnd ? 0 : currentPos
      if (atEnd) { setDotPosition(0); setHighlightIndex(0) }
      startTimeRef.current = null
      setIsPlaying(true)
      rafRef.current = requestAnimationFrame(tick)
    }
  }, [isPlaying, dotPosition, segments.length, stopPlayback, tick])

  useEffect(() => () => { if (rafRef.current !== null) cancelAnimationFrame(rafRef.current) }, [])

  const handleEmbed = async () => {
    setPhase({ status: 'model-loading', progress: 0 })
    await new Promise(resolve => setTimeout(resolve, 0)) // flush render before heavy work
    try {
      const vectors = await getEmbeddings(segments, (loaded, total, phaseLabel) => {
        if (phaseLabel === 'model-loading') {
          setPhase({ status: 'model-loading', progress: loaded })
        } else {
          setPhase({ status: 'embedding', loaded, total })
        }
      })
      setPhase({ status: 'umap-running' })
      await new Promise(resolve => setTimeout(resolve, 0))
      const points = runUmap(vectors)
      setPhase({ status: 'done', points })
    } catch (e) {
      setPhase({ status: 'error', message: String(e) })
    }
  }

  const isDone = phase.status === 'done'
  const scrubPosition = dotPosition !== null ? dotPosition / (segments.length - 1) : 0

  const handleScrub = (e: React.MouseEvent<HTMLDivElement>) => {
    stopPlayback()
    const rect = e.currentTarget.getBoundingClientRect()
    const floatPos = Math.max(0, Math.min(segments.length - 1, (e.clientX - rect.left) / rect.width * (segments.length - 1)))
    setDotPosition(floatPos)
    setHighlightIndex(Math.round(floatPos))
  }

  const handleScrubMove = (e: React.MouseEvent<HTMLDivElement>) => {
    if (e.buttons !== 1) return
    handleScrub(e)
  }

  return (
    <div className="projector-backdrop" onClick={e => { if (e.target === e.currentTarget) onClose() }}>
      <div className="projector-panel">
        <div className="projector-header">
          <h2>Segment Projector</h2>
          <button className="projector-close" onClick={onClose}>✕</button>
        </div>

        {isDone && (
          <div className="projector-player">
            <button className="player-btn" onClick={handlePlayPause}>
              {isPlaying ? '⏸' : dotPosition !== null && dotPosition >= segments.length - 1 ? '↺' : '▶'}
            </button>
            <div className="player-scrub" onClick={handleScrub} onMouseMove={handleScrubMove}>
              <div className="player-scrub-fill" style={{ width: `${scrubPosition * 100}%` }} />
              <div className="player-scrub-thumb" style={{ left: `${scrubPosition * 100}%` }} />
            </div>
            <span className="player-counter">
              {highlightIndex !== null ? highlightIndex + 1 : '—'} / {segments.length}
            </span>
          </div>
        )}

        <div className={`projector-body ${isDone ? 'projector-body--split' : ''}`}>
          <div className="projector-list-col">
            {!isDone && (
              <div className="projector-controls">
                {phase.status === 'idle' && (
                  <button onClick={handleEmbed} className="embed-btn">Embed All</button>
                )}
                {phase.status === 'model-loading' && (
                  <div className="progress-wrap">
                    <div className="progress-label">
                      <div className="spinner" />
                      <span>{phase.progress > 0 ? `Downloading model… ${phase.progress}%` : 'Initializing model…'}</span>
                    </div>
                    <div className={`progress-bar ${phase.progress === 0 ? 'progress-bar--indeterminate' : ''}`}>
                      <div className="progress-bar-fill" style={{ width: `${phase.progress}%` }} />
                    </div>
                  </div>
                )}
                {phase.status === 'embedding' && (
                  <div className="progress-wrap">
                    <div className="progress-label">
                      <div className="spinner" />
                      <span>Embedding {phase.loaded + 1} / {phase.total}</span>
                    </div>
                    <div className="progress-bar">
                      <div className="progress-bar-fill" style={{ width: `${(phase.loaded / phase.total) * 100}%` }} />
                    </div>
                  </div>
                )}
                {phase.status === 'umap-running' && (
                  <div className="progress-wrap">
                    <div className="progress-label">
                      <div className="spinner" />
                      <span>Reducing to 3D…</span>
                    </div>
                    <div className="progress-bar progress-bar--indeterminate">
                      <div className="progress-bar-fill" />
                    </div>
                  </div>
                )}
                {phase.status === 'error' && (
                  <p className="projector-error">{phase.message}</p>
                )}
              </div>
            )}

            <ul className="segment-list" ref={listRef}>
              {segments.map((seg, i) => (
                <li
                  key={i}
                  className={`segment-item ${highlightIndex === i ? 'segment-item--active' : ''}`}
                  onClick={() => { stopPlayback(); setDotPosition(i); setHighlightIndex(i) }}
                >
                  <span className="segment-index">{i + 1}</span>
                  <span className="segment-text">{seg}</span>
                </li>
              ))}
            </ul>
          </div>

          {isDone && (
            <div className="projector-canvas-col">
              <ScatterPlot3D
                points={phase.points}
                labels={segments}
                highlightPosition={dotPosition}
                onPointClick={idx => { stopPlayback(); setDotPosition(idx); setHighlightIndex(idx) }}
              />
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
