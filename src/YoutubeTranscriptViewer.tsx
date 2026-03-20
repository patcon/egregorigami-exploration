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
  const [urlInput, setUrlInput] = useState(() => localStorage.getItem('yt-url') ?? '')
  const [loadedText, setLoadedText] = useState<string | null>(() => localStorage.getItem('yt-transcript'))
  const [loadedDuration, setLoadedDuration] = useState<string | null>(() => localStorage.getItem('yt-duration'))
  const [loadedVideoId, setLoadedVideoId] = useState<string | null>(() => localStorage.getItem('yt-video-id'))
  const [loadCount, setLoadCount] = useState(0)
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
      const duration = String(Math.round(data.totalDuration))
      setLoadedText(text)
      setLoadedDuration(duration)
      setLoadedVideoId(videoId)
      setLoadCount(c => c + 1)
      localStorage.setItem('yt-transcript', text)
      localStorage.setItem('yt-duration', duration)
      localStorage.setItem('yt-video-id', videoId)
      setStatus('idle')
    } catch (e) {
      setStatus('error')
      setErrorMessage(String(e))
    }
  }

  const currentVideoId = extractVideoId(urlInput)
  const transcriptToolUrl = currentVideoId
    ? `https://www.youtube-transcript.io/videos?id=${currentVideoId}`
    : 'https://www.youtube-transcript.io'

  return (
    <div className="youtube-viewer-wrapper">
      <div className="youtube-bar">
        {isProd && (
          <p className="youtube-notice">
            {currentVideoId ? (
              <>
                <a href={transcriptToolUrl} target="_blank" rel="noopener">Get transcript on youtube-transcript.io ↗</a>
                {' '}— then paste it into the text area below.
              </>
            ) : (
              <>Paste a YouTube URL above, then grab the transcript from{' '}
                <a href={transcriptToolUrl} target="_blank" rel="noopener">youtube-transcript.io ↗</a>
                {' '}and paste it below.
              </>
            )}
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
        key={`${loadedVideoId ?? 'empty'}-${loadCount}`}
        initialText={loadedText ?? undefined}
        initialDuration={loadedDuration ?? undefined}
      />
    </div>
  )
}
