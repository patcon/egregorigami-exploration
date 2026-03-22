import { useState, useRef, useCallback } from 'react'
import TranscriptViewer from './TranscriptViewer'
import YoutubePlayerEmbed from './YoutubePlayerEmbed'
import SegmentProjectorModal from './SegmentProjectorModal'
import { buildTranscriptData } from './subtitleParser'
import './YoutubeTranscriptViewer.css'
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

function computeChunks(text: string, windowSize: number, overlapPct: number): string[] {
  const words = text.trim().split(/\s+/).filter(Boolean)
  if (words.length === 0) return []
  const step = Math.max(1, Math.round(windowSize * (1 - overlapPct / 100)))
  const chunks: string[] = []
  // Start at windowSize-1 so the first chunk is a full window (no clamping duplicates)
  for (let cursor = Math.min(windowSize - 1, words.length - 1); cursor < words.length; cursor += step) {
    const windowStart = Math.max(0, cursor - windowSize + 1)
    chunks.push(words.slice(windowStart, windowStart + windowSize).join(' '))
  }
  return chunks
}

const isProd = import.meta.env.PROD

export default function YoutubeEmbeddingProjector() {
  const [urlInput, setUrlInput] = useState(() => localStorage.getItem('yt-url') ?? '')
  const [loadedText, setLoadedText] = useState<string | null>(() => localStorage.getItem('yt-transcript'))
  const [loadedDuration, setLoadedDuration] = useState<string | null>(() => localStorage.getItem('yt-duration'))
  const [loadedVideoId, setLoadedVideoId] = useState<string | null>(() =>
    extractVideoId(localStorage.getItem('yt-url') ?? '') ? localStorage.getItem('yt-video-id') : null
  )
  const [loadCount, setLoadCount] = useState(0)
  const [status, setStatus] = useState<'idle' | 'loading' | 'error'>('idle')
  const [errorMessage, setErrorMessage] = useState('')
  const [wordTimestamps, setWordTimestamps] = useState<number[] | null>(
    () => JSON.parse(localStorage.getItem('yt-word-timestamps') ?? 'null')
  )
  const [modalSegments, setModalSegments] = useState<string[] | null>(null)
  const [videoTime, setVideoTime] = useState(0)
  const [seekTarget, setSeekTarget] = useState<number | undefined>(undefined)
  const [transcriptPlaying, setTranscriptPlaying] = useState(false)
  const [ytPlaying, setYtPlaying] = useState(false)
  const [playbackRate, setPlaybackRate] = useState(1)
  const [allowFaster, setAllowFaster] = useState(false)

  // Track current window params from TranscriptViewer without re-renders
  const windowParamsRef = useRef<{ windowSize: number; overlapPct: number; text: string }>({
    windowSize: 20,
    overlapPct: 50,
    text: loadedText ?? '',
  })

  const [hasTranscriptText, setHasTranscriptText] = useState(() => !!(loadedText?.trim()))

  const handleWindowChange = useCallback((params: { windowSize: number; overlapPct: number; text: string }) => {
    windowParamsRef.current = params
    setHasTranscriptText(!!params.text.trim())
  }, [])

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
      const { text, wordTimestamps } = buildTranscriptData(data.segments)
      const duration = String(Math.round(data.totalDuration))
      setLoadedText(text)
      setLoadedDuration(duration)
      setLoadedVideoId(videoId)
      setWordTimestamps(wordTimestamps)
      setLoadCount(c => c + 1)
      localStorage.setItem('yt-url', urlInput)
      localStorage.setItem('yt-transcript', text)
      localStorage.setItem('yt-duration', duration)
      localStorage.setItem('yt-video-id', videoId)
      localStorage.setItem('yt-word-timestamps', JSON.stringify(wordTimestamps))
      localStorage.setItem('transcript-raw-text', text)
      setStatus('idle')
    } catch (e) {
      setStatus('error')
      setErrorMessage(String(e))
    }
  }

  const totalSecs = loadedDuration ? parseInt(loadedDuration) : null
  const externalPosition = (() => {
    if (!totalSecs) return undefined
    if (wordTimestamps && wordTimestamps.length > 1) {
      if (videoTime < wordTimestamps[0]) return 0
      // Find first word index of the current segment (last segment whose offset <= videoTime)
      let segFirstIdx = 0
      for (let i = 1; i < wordTimestamps.length; i++) {
        if (wordTimestamps[i] > videoTime) break
        if (wordTimestamps[i] > wordTimestamps[i - 1]) segFirstIdx = i
      }
      // Find last word index of this segment
      let segLastIdx = segFirstIdx
      while (segLastIdx + 1 < wordTimestamps.length && wordTimestamps[segLastIdx + 1] === wordTimestamps[segFirstIdx]) {
        segLastIdx++
      }
      // Interpolate within the segment using the next segment's start as the boundary
      const segStart = wordTimestamps[segFirstIdx]
      const nextSegStart = segLastIdx + 1 < wordTimestamps.length ? wordTimestamps[segLastIdx + 1] : totalSecs
      const segDuration = nextSegStart - segStart
      const segWordCount = segLastIdx - segFirstIdx + 1
      const wordOffset = segDuration > 0
        ? Math.min(Math.floor(((videoTime - segStart) / segDuration) * segWordCount), segWordCount - 1)
        : 0
      return (segFirstIdx + wordOffset) / (wordTimestamps.length - 1)
    }
    return videoTime / totalSecs
  })()

  const handleScrub = useCallback((pos: number) => {
    if (!totalSecs) return
    const t = pos * totalSecs
    setVideoTime(t)
    setSeekTarget(t)
  }, [totalSecs])

  const currentVideoId = extractVideoId(urlInput)
  const transcriptToolUrl = currentVideoId
    ? `https://www.youtube-transcript.io/videos?id=${currentVideoId}`
    : 'https://www.youtube-transcript.io'

  const handleSubtitleLoad = useCallback((result: { text: string; wordTimestamps: number[]; durationSecs: number }) => {
    setLoadedText(result.text)
    setLoadedDuration(String(result.durationSecs))
    setWordTimestamps(result.wordTimestamps)
    setLoadedVideoId(null)
    setLoadCount(c => c + 1)
    localStorage.setItem('yt-transcript', result.text)
    localStorage.setItem('yt-duration', String(result.durationSecs))
    localStorage.setItem('yt-word-timestamps', JSON.stringify(result.wordTimestamps))
    localStorage.removeItem('yt-video-id')
  }, [])

  const handleOpenProjector = () => {
    const { windowSize, overlapPct, text } = windowParamsRef.current
    const chunks = computeChunks(text, windowSize, overlapPct)
    setModalSegments(chunks)
  }

  return (
    <div className="youtube-viewer-wrapper">
      <div className="youtube-bar">
        <div className="youtube-row">
          <input
            type="url"
            className="youtube-url-input"
            value={urlInput}
            onChange={e => {
              const val = e.target.value
              setUrlInput(val)
              localStorage.setItem('yt-url', val)
              if (!extractVideoId(val)) {
                setLoadedVideoId(null)
                setWordTimestamps(null)
                localStorage.removeItem('yt-word-timestamps')
              }
            }}
            onKeyDown={e => { if (e.key === 'Enter' && !isProd) handleLoad() }}
            placeholder="https://www.youtube.com/watch?v=..."
          />
          <button className="yt-action-btn"
            onClick={isProd ? () => window.open(transcriptToolUrl, '_blank') : handleLoad}
            disabled={isProd ? !currentVideoId : status === 'loading'}>
            {!isProd && status === 'loading' ? 'Loading…' : `Fetch Transcript${isProd ? ' ↗' : ''}`}
          </button>
          {hasTranscriptText && (
            <button className="open-projector-btn" onClick={handleOpenProjector}>
              Open Projector
            </button>
          )}
        </div>
        {status === 'error' && <p className="youtube-error">{errorMessage}</p>}
        {isProd && (
          <p className="youtube-notice">
            {currentVideoId
              ? <>Paste or load the downloaded transcript below. VTT or SRT preferred — copied plaintext lacks timing and will degrade the experience.</>
              : <>Paste a YouTube URL above to get started.</>
            }
          </p>
        )}
      </div>

      {currentVideoId && (
        <div style={{ position: 'relative' }}>
          <div style={{ visibility: allowFaster ? 'hidden' : 'visible' }}>
            <YoutubePlayerEmbed
              videoId={currentVideoId}
              onTimeUpdate={setVideoTime}
              seekTo={allowFaster ? undefined : seekTarget}
              playing={allowFaster ? false : transcriptPlaying}
              onPlayStateChange={allowFaster ? undefined : setYtPlaying}
              playbackRate={playbackRate}
            />
          </div>
          {allowFaster && (
            <div className="yt-player-container" style={{ position: 'absolute', inset: 0, margin: 0 }}>
              <div className="yt-player-aspect" style={{ background: 'var(--code-bg)', borderRadius: 4, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                <span style={{ color: 'var(--text)', opacity: 0.4, fontSize: 13 }}>YouTube paused — allow faster enabled</span>
              </div>
            </div>
          )}
        </div>
      )}
      <TranscriptViewer
        key={`${loadedVideoId ?? 'empty'}-${loadCount}`}
        initialText={loadedText ?? undefined}
        initialDuration={loadedDuration ?? undefined}
        onWindowChange={handleWindowChange}
        externalPosition={externalPosition}
        externalPlaying={ytPlaying}
        onScrub={handleScrub}
        onPlayingChange={setTranscriptPlaying}
        onSpeedChange={setPlaybackRate}
        maxSpeed={loadedVideoId ? 2 : undefined}
        onAllowFasterChange={setAllowFaster}
        onSubtitleLoad={handleSubtitleLoad}
      />

      {modalSegments && (
        <SegmentProjectorModal
          segments={modalSegments}
          onClose={() => setModalSegments(null)}
        />
      )}
    </div>
  )
}
