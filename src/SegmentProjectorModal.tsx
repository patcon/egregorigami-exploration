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
  const [isPlaying, setIsPlaying] = useState(false)
  const listRef = useRef<HTMLUListElement>(null)
  const rafRef = useRef<number | null>(null)
  const startTimeRef = useRef<number | null>(null)
  const startIndexRef = useRef(0)

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
    const progress = Math.min(1, elapsed / PLAYBACK_DURATION)
    const idx = Math.min(segments.length - 1, Math.floor(progress * segments.length) + startIndexRef.current)
    setHighlightIndex(idx)
    if (idx >= segments.length - 1) {
      stopPlayback()
      return
    }
    rafRef.current = requestAnimationFrame(tick)
  }, [segments.length, stopPlayback])

  const handlePlayPause = useCallback(() => {
    if (isPlaying) {
      stopPlayback()
    } else {
      const currentIdx = highlightIndex ?? 0
      const atEnd = currentIdx >= segments.length - 1
      startIndexRef.current = atEnd ? 0 : currentIdx
      if (atEnd) setHighlightIndex(0)
      startTimeRef.current = null
      setIsPlaying(true)
      rafRef.current = requestAnimationFrame(tick)
    }
  }, [isPlaying, highlightIndex, segments.length, stopPlayback, tick])

  useEffect(() => () => { if (rafRef.current !== null) cancelAnimationFrame(rafRef.current) }, [])

  const handleEmbed = async () => {
    setPhase({ status: 'model-loading', progress: 0 })
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
  const scrubPosition = highlightIndex !== null ? highlightIndex / (segments.length - 1) : 0

  const handleScrub = (e: React.MouseEvent<HTMLDivElement>) => {
    stopPlayback()
    const rect = e.currentTarget.getBoundingClientRect()
    const pos = Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width))
    setHighlightIndex(Math.round(pos * (segments.length - 1)))
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
              {isPlaying ? '⏸' : highlightIndex !== null && highlightIndex >= segments.length - 1 ? '↺' : '▶'}
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
                    <span>Loading model… {phase.progress}%</span>
                    <progress value={phase.progress} max={100} />
                  </div>
                )}
                {phase.status === 'embedding' && (
                  <div className="progress-wrap">
                    <span>Embedding {phase.loaded + 1} / {phase.total}</span>
                    <progress value={phase.loaded} max={phase.total} />
                  </div>
                )}
                {phase.status === 'umap-running' && (
                  <div className="progress-wrap"><span>Running UMAP…</span></div>
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
                  onClick={() => { stopPlayback(); setHighlightIndex(i) }}
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
                highlightIndex={highlightIndex}
                onPointClick={idx => { stopPlayback(); setHighlightIndex(idx) }}
              />
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
