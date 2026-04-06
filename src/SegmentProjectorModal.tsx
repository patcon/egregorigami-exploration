import { useEffect, useRef, useState, useCallback } from 'react'
import { EMBEDDING_MODELS, type EmbeddingModelId } from './embedSegments'
import { useEmbeddingWorker } from './useEmbeddingWorker'
import { usePointsCache } from './usePointsCache'
import ScatterPlot3D from './ScatterPlot3D'

const PLAYBACK_DURATION = 10 // seconds to walk all segments

interface Props {
  segments: string[]
  onClose: () => void
  videoId?: string | null
}

export default function SegmentProjectorModal({ segments, onClose, videoId = null }: Props) {
  const [selectedModel, setSelectedModel] = useState<EmbeddingModelId>(() => {
    const stored = localStorage.getItem('projector-model')
    return (EMBEDDING_MODELS.find(m => m.id === stored) ?? EMBEDDING_MODELS.find(m => m.default)!).id
  })
  const { phase, runEmbedding, cancelEmbedding, restorePoints } = useEmbeddingWorker()
  const { savePoints } = usePointsCache(videoId, restorePoints)
  useEffect(() => {
    if (phase.status === 'done') savePoints(phase.points)
  }, [phase]) // eslint-disable-line react-hooks/exhaustive-deps
  const [highlightIndex, setHighlightIndex] = useState<number | null>(null)
  const [dotPosition, setDotPosition] = useState<number | null>(null) // float for smooth interpolation
  const [isPlaying, setIsPlaying] = useState(false)
  const listRef = useRef<HTMLUListElement>(null)
  const rafRef = useRef<number | null>(null)
  const startTimeRef = useRef<number | null>(null)
  const tickStartPosRef = useRef(0)
  const tickFnRef = useRef<FrameRequestCallback | null>(null)

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
    if (tickFnRef.current) rafRef.current = requestAnimationFrame(tickFnRef.current)
  }, [segments.length, stopPlayback])

  useEffect(() => { tickFnRef.current = tick }, [tick])

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
      if (tickFnRef.current) rafRef.current = requestAnimationFrame(tickFnRef.current)
    }
  }, [isPlaying, dotPosition, segments.length, stopPlayback])

  useEffect(() => () => { if (rafRef.current !== null) cancelAnimationFrame(rafRef.current) }, [])

  const handleEmbed = () => {
    runEmbedding(segments, selectedModel)
  }

  const isDone = phase.status === 'done'

  const handleDownload = () => {
    if (phase.status !== 'done') return
    const blob = new Blob([JSON.stringify(phase.points)], { type: 'application/json' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = 'embeddings-3d.json'
    a.click()
    URL.revokeObjectURL(url)
  }
  const scrubPosition = dotPosition !== null ? dotPosition / (segments.length - 1) : 0

  const scrubRectRef = useRef<DOMRect | null>(null)

  const applyScrubPosition = (clientX: number) => {
    if (!scrubRectRef.current) return
    const rect = scrubRectRef.current
    const floatPos = Math.max(0, Math.min(segments.length - 1, (clientX - rect.left) / rect.width * (segments.length - 1)))
    setDotPosition(floatPos)
    setHighlightIndex(Math.round(floatPos))
  }

  const handleScrubPointerDown = (e: React.PointerEvent<HTMLDivElement>) => {
    e.preventDefault()
    e.currentTarget.setPointerCapture(e.pointerId)
    scrubRectRef.current = e.currentTarget.getBoundingClientRect()
    stopPlayback()
    applyScrubPosition(e.clientX)
  }

  const handleScrubPointerMove = (e: React.PointerEvent<HTMLDivElement>) => {
    if (!e.currentTarget.hasPointerCapture(e.pointerId)) return
    applyScrubPosition(e.clientX)
  }

  return (
    <div className="fixed inset-0 bg-black/60 z-[100] flex items-center justify-center p-4" onClick={e => { if (e.target === e.currentTarget) onClose() }}>
      <div className="bg-bg border border-border rounded-[10px] w-full max-w-[900px] max-h-[85vh] flex flex-col overflow-hidden">
        <div className="flex items-center justify-between py-3.5 px-5 border-b border-border flex-shrink-0">
          <h2 className="m-0 text-[17px] text-text-h">Segment Projector</h2>
          <button className="bg-transparent border-0 text-text text-lg cursor-pointer py-1 px-2 rounded leading-none hover:bg-code-bg" onClick={onClose}>✕</button>
        </div>

        {isDone && (
          <div className="flex items-center gap-2.5 py-2 px-4 border-b border-border flex-shrink-0">
            <button className="bg-transparent border border-border rounded-md text-text-h text-base w-[34px] h-[30px] cursor-pointer flex items-center justify-center flex-shrink-0 hover:bg-code-bg" onClick={handlePlayPause}>
              {isPlaying ? '⏸' : dotPosition !== null && dotPosition >= segments.length - 1 ? '↺' : '▶'}
            </button>
            <div className="flex-1 h-[6px] bg-code-bg rounded-[3px] relative cursor-pointer py-2 -my-2 select-none touch-none" onPointerDown={handleScrubPointerDown} onPointerMove={handleScrubPointerMove}>
              <div className="absolute left-0 top-0 h-full bg-accent rounded-[3px] pointer-events-none" style={{ width: `${scrubPosition * 100}%` }} />
              <div className="absolute top-1/2 -translate-x-1/2 -translate-y-1/2 w-3 h-3 rounded-full bg-accent pointer-events-none" style={{ left: `${scrubPosition * 100}%` }} />
            </div>
            <span className="text-xs text-text tabular-nums whitespace-nowrap min-w-[56px] text-right">
              {highlightIndex !== null ? highlightIndex + 1 : '—'} / {segments.length}
            </span>
            <button className="bg-transparent border border-border rounded-md text-text-h text-base w-[34px] h-[30px] cursor-pointer flex items-center justify-center flex-shrink-0 hover:bg-code-bg" onClick={handleDownload} title="Download 3D points as JSON">⬇</button>
          </div>
        )}

        <div className={`flex flex-1 min-h-0 ${isDone ? 'flex-row' : 'flex-col'}`}>
          <div className={`flex flex-col min-h-0 overflow-hidden ${isDone ? 'w-[280px] flex-shrink-0 border-r border-border' : 'w-full'}`}>
            {!isDone && (
              <div className="py-3 px-4 border-b border-border flex-shrink-0">
                {phase.status === 'idle' && (
                  <div className="flex gap-2 items-center">
                    <select
                      className="flex-1 py-1.5 px-2 border border-border rounded-md bg-code-bg text-text-h text-[13px] cursor-pointer focus:outline-2 focus:outline-accent focus:outline-offset-[1px]"
                      value={selectedModel}
                      onChange={e => { const v = e.target.value as EmbeddingModelId; setSelectedModel(v); localStorage.setItem('projector-model', v) }}
                    >
                      {EMBEDDING_MODELS.map(m => (
                        <option key={m.id} value={m.id}>{m.label}</option>
                      ))}
                    </select>
                    <button onClick={handleEmbed} className="py-2 px-[18px] rounded-md border-0 bg-accent text-white text-sm cursor-pointer font-semibold hover:opacity-[0.88]">Embed All</button>
                  </div>
                )}
                {phase.status === 'model-loading' && (
                  <div className="flex flex-col gap-2 text-[13px] text-text">
                    <div className="flex items-center gap-2">
                      <div className="spinner" />
                      <span>{phase.progress > 0 ? `Downloading model… ${phase.progress}%` : 'Initializing model…'}</span>
                      <button className="ml-auto py-[3px] px-2.5 rounded border border-border bg-transparent text-text text-xs cursor-pointer opacity-70 hover:opacity-100" onClick={cancelEmbedding}>Cancel</button>
                    </div>
                    <div className={`progress-bar ${phase.progress === 0 ? 'progress-bar--indeterminate' : ''}`}>
                      <div className="progress-bar-fill" style={{ width: `${phase.progress}%` }} />
                    </div>
                  </div>
                )}
                {phase.status === 'embedding' && (
                  <div className="flex flex-col gap-2 text-[13px] text-text">
                    <div className="flex items-center gap-2">
                      <div className="spinner" />
                      <span>Embedding {phase.loaded + 1} / {phase.total}</span>
                      <button className="ml-auto py-[3px] px-2.5 rounded border border-border bg-transparent text-text text-xs cursor-pointer opacity-70 hover:opacity-100" onClick={cancelEmbedding}>Cancel</button>
                    </div>
                    <div className="progress-bar">
                      <div className="progress-bar-fill" style={{ width: `${(phase.loaded / phase.total) * 100}%` }} />
                    </div>
                  </div>
                )}
                {phase.status === 'umap-running' && (
                  <div className="flex flex-col gap-2 text-[13px] text-text">
                    <div className="flex items-center gap-2">
                      <div className="spinner" />
                      <span>Reducing to 3D…</span>
                      <button className="ml-auto py-[3px] px-2.5 rounded border border-border bg-transparent text-text text-xs cursor-pointer opacity-70 hover:opacity-100" onClick={cancelEmbedding}>Cancel</button>
                    </div>
                    <div className="progress-bar progress-bar--indeterminate">
                      <div className="progress-bar-fill" />
                    </div>
                  </div>
                )}
                {phase.status === 'error' && (
                  <p className="text-[#e53e3e] text-[13px] m-0">{phase.message}</p>
                )}
              </div>
            )}

            <ul className="list-none p-0 m-0 overflow-y-auto flex-1 min-h-0" ref={listRef}>
              {segments.map((seg, i) => (
                <li
                  key={i}
                  className={`flex gap-2 py-2 px-3.5 border-b border-border cursor-pointer text-[13px] items-start transition-colors duration-[120ms] hover:bg-code-bg ${highlightIndex === i ? 'segment-item--active' : ''}`}
                  onClick={() => { stopPlayback(); setDotPosition(i); setHighlightIndex(i) }}
                >
                  <span className="text-text opacity-50 min-w-[28px] flex-shrink-0 text-right tabular-nums pt-[1px]">{i + 1}</span>
                  <span className="text-text-h leading-[1.45]">{seg}</span>
                </li>
              ))}
            </ul>
          </div>

          {isDone && (
            <div className="flex-1 min-h-0 flex">
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
