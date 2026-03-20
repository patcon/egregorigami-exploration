import { useEffect, useRef, useState } from 'react'
import { getEmbeddings } from './embedSegments'
import { runUmap } from './runUmap'
import ScatterPlot3D from './ScatterPlot3D'
import './SegmentProjectorModal.css'

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
  const listRef = useRef<HTMLUListElement>(null)

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

  const handleEmbed = async () => {
    setPhase({ status: 'model-loading', progress: 0 })
    try {
      const texts = segments
      const vectors = await getEmbeddings(texts, (loaded, total, phaseLabel) => {
        if (phaseLabel === 'model-loading') {
          setPhase({ status: 'model-loading', progress: loaded })
        } else {
          setPhase({ status: 'embedding', loaded, total })
        }
      })
      setPhase({ status: 'umap-running' })
      // Defer UMAP so spinner can render
      await new Promise(resolve => setTimeout(resolve, 0))
      const points = runUmap(vectors)
      setPhase({ status: 'done', points })
    } catch (e) {
      setPhase({ status: 'error', message: String(e) })
    }
  }

  const isDone = phase.status === 'done'

  return (
    <div className="projector-backdrop" onClick={e => { if (e.target === e.currentTarget) onClose() }}>
      <div className="projector-panel">
        <div className="projector-header">
          <h2>Segment Projector</h2>
          <button className="projector-close" onClick={onClose}>✕</button>
        </div>

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
                  onClick={() => setHighlightIndex(i)}
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
                onPointClick={idx => setHighlightIndex(idx)}
              />
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
