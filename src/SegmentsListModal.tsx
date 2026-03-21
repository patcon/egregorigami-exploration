import { useEffect } from 'react'
import './SegmentProjectorModal.css'

interface Props {
  segments: string[]
  onClose: () => void
}

export default function SegmentsListModal({ segments, onClose }: Props) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose() }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  return (
    <div className="projector-backdrop" onClick={e => { if (e.target === e.currentTarget) onClose() }}>
      <div className="projector-panel">
        <div className="projector-header">
          <h2>Segments</h2>
          <button className="projector-close" onClick={onClose}>✕</button>
        </div>
        <div className="projector-body">
          <div className="projector-list-col">
            <ul className="segment-list">
              {segments.map((seg, i) => (
                <li key={i} className="segment-item">
                  <span className="segment-index">{i + 1}</span>
                  <span className="segment-text">{seg}</span>
                </li>
              ))}
            </ul>
          </div>
        </div>
      </div>
    </div>
  )
}
