import { useState } from 'react'
import SegmentProjectorModal from './SegmentProjectorModal'
import './YoutubeEmbeddingProjector.css'

function extractVideoId(url: string): string | null {
  try {
    const u = new URL(url.trim())
    if (u.hostname === 'youtu.be') return u.pathname.slice(1)
    if (u.hostname.includes('youtube.com')) return u.searchParams.get('v')
    return null
  } catch {
    return /^[a-zA-Z0-9_-]{11}$/.test(url.trim()) ? url.trim() : null
  }
}

const isProd = import.meta.env.PROD

export default function YoutubeEmbeddingProjector() {
  const [urlInput, setUrlInput] = useState(() => localStorage.getItem('yt-url') ?? '')
  const [segmentCount, setSegmentCount] = useState<number | null>(() => {
    const stored = localStorage.getItem('yt-segments')
    if (!stored) return null
    try { return JSON.parse(stored).length } catch { return null }
  })
  const [status, setStatus] = useState<'idle' | 'loading' | 'error'>('idle')
  const [errorMessage, setErrorMessage] = useState('')
  const [modalOpen, setModalOpen] = useState(false)

  const handleLoad = async () => {
    const videoId = extractVideoId(urlInput)
    if (!videoId) {
      setStatus('error')
      setErrorMessage('Could not extract a video ID from the input.')
      return
    }
    setStatus('loading')
    setErrorMessage('')
    try {
      const res = await fetch(`/api/transcript?videoId=${encodeURIComponent(videoId)}`)
      const data = await res.json()
      if (!res.ok) throw new Error(data.error ?? `HTTP ${res.status}`)
      localStorage.setItem('yt-url', urlInput)
      localStorage.setItem('yt-segments', JSON.stringify(data.segments))
      setSegmentCount(data.segments.length)
      setStatus('idle')
    } catch (e) {
      setStatus('error')
      setErrorMessage(String(e))
    }
  }

  return (
    <div className="projector-page">
      <div className="projector-topbar">
        <h1 className="projector-title">Embedding Projector</h1>
        {isProd && (
          <p className="youtube-notice">
            ⚠ Transcript loading requires a local dev server and is not available on this hosted site.{' '}
            <a href="https://github.com/patcon/egregorigami-exploration" target="_blank" rel="noopener">Run it locally</a> to use this feature.
          </p>
        )}
        <div className="youtube-row">
          <input
            type="url"
            className="youtube-url-input"
            value={urlInput}
            onChange={e => { setUrlInput(e.target.value); localStorage.setItem('yt-url', e.target.value) }}
            onKeyDown={e => { if (e.key === 'Enter' && !isProd) handleLoad() }}
            placeholder="https://www.youtube.com/watch?v=..."
            disabled={isProd}
          />
          <button onClick={handleLoad} disabled={isProd || status === 'loading'}>
            {status === 'loading' ? 'Loading…' : 'Load'}
          </button>
        </div>
        {status === 'error' && <p className="youtube-error">{errorMessage}</p>}
        {segmentCount !== null && (
          <div className="projector-loaded-row">
            <span className="projector-segment-count">{segmentCount} segments loaded</span>
            <button className="open-projector-btn" onClick={() => setModalOpen(true)}>
              Open Segment Projector
            </button>
          </div>
        )}
      </div>

      {modalOpen && <SegmentProjectorModal onClose={() => setModalOpen(false)} />}
    </div>
  )
}
