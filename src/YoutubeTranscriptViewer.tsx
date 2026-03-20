import { useState } from 'react'
import TranscriptViewer from './TranscriptViewer'
import './YoutubeTranscriptViewer.css'

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

export default function YoutubeTranscriptViewer() {
  const [urlInput, setUrlInput] = useState('')
  const [loadedText, setLoadedText] = useState<string | null>(null)
  const [loadedDuration, setLoadedDuration] = useState<string | null>(null)
  const [loadedVideoId, setLoadedVideoId] = useState<string | null>(null)
  const [status, setStatus] = useState<'idle' | 'loading' | 'error'>('idle')
  const [errorMessage, setErrorMessage] = useState('')

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
      if (!res.ok) {
        throw new Error(data.error ?? `HTTP ${res.status}`)
      }
      const text = data.segments.map((s: { text: string }) => s.text).join(' ')
      setLoadedText(text)
      setLoadedDuration(String(Math.round(data.totalDuration)))
      setLoadedVideoId(videoId)
      setStatus('idle')
    } catch (e) {
      setStatus('error')
      setErrorMessage(String(e))
    }
  }

  return (
    <div className="youtube-viewer-wrapper">
      <div className="youtube-bar">
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
            onChange={e => setUrlInput(e.target.value)}
            onKeyDown={e => { if (e.key === 'Enter' && !isProd) handleLoad() }}
            placeholder="https://www.youtube.com/watch?v=..."
            disabled={isProd}
          />
          <button
            onClick={handleLoad}
            disabled={isProd || status === 'loading'}
          >
            {status === 'loading' ? 'Loading…' : 'Load'}
          </button>
        </div>
        {status === 'error' && <p className="youtube-error">{errorMessage}</p>}
      </div>
      <TranscriptViewer
        key={loadedVideoId ?? 'empty'}
        initialText={loadedText ?? undefined}
        initialDuration={loadedDuration ?? undefined}
      />
    </div>
  )
}
