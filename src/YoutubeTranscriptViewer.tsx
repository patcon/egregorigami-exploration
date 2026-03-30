import { useState, useRef, useEffect } from 'react'
import TranscriptViewer from './TranscriptViewer'
import YoutubePlayerEmbed from './YoutubePlayerEmbed'
import { extractVideoId, computeExternalPosition } from './videoUtils'
import { useVideoKeyboardControls } from './useVideoKeyboardControls'
import { useYoutubeTranscript } from './useYoutubeTranscript'
import './YoutubeTranscriptViewer.css'

const isProd = import.meta.env.PROD

export default function YoutubeTranscriptViewer() {
  const [urlInput, setUrlInput] = useState(() => {
    const qsVideoId = new URLSearchParams(window.location.search).get('videoId')
    if (qsVideoId) return `https://www.youtube.com/watch?v=${qsVideoId}`
    return localStorage.getItem('yt-url') ?? ''
  })
  const {
    loadedText, loadedDuration, loadedVideoId, wordTimestamps, loadCount,
    status, errorMessage, handleLoad, handleSubtitleLoad,
    setLoadedVideoId, setWordTimestamps,
  } = useYoutubeTranscript(urlInput)
  const [videoTime, setVideoTime] = useState(0)
  const [seekTarget, setSeekTarget] = useState<number | undefined>(undefined)
  const [transcriptPlaying, setTranscriptPlaying] = useState(false)
  const [ytPlaying, setYtPlaying] = useState(false)
  const [playbackRate, setPlaybackRate] = useState(1)
  const videoTimeRef = useRef(0)
  useEffect(() => { videoTimeRef.current = videoTime }, [videoTime])

  useVideoKeyboardControls(videoTimeRef, setVideoTime, setSeekTarget, setYtPlaying)

  const totalSecs = loadedDuration ? parseInt(loadedDuration) : null
  const externalPosition = computeExternalPosition(videoTime, wordTimestamps, totalSecs)

  const handleScrub = (pos: number) => {
    if (!totalSecs) return
    const t = pos * totalSecs
    setVideoTime(t)
    setSeekTarget(t)
  }

  const currentVideoId = extractVideoId(urlInput)
  const transcriptToolUrl = currentVideoId
    ? `https://www.youtube-transcript.io/videos?id=${currentVideoId}`
    : 'https://www.youtube-transcript.io'

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
          <button
            className="yt-action-btn"
            onClick={isProd ? () => window.open(transcriptToolUrl, '_blank') : handleLoad}
            disabled={isProd ? !currentVideoId : status === 'loading'}
          >
            {!isProd && status === 'loading' ? 'Loading…' : `Fetch Transcript${isProd ? ' ↗' : ''}`}
          </button>
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
      {currentVideoId ? (
        <YoutubePlayerEmbed
          videoId={currentVideoId}
          onTimeUpdate={setVideoTime}
          seekTo={seekTarget}
          playing={transcriptPlaying}
          onPlayStateChange={setYtPlaying}
          playbackRate={playbackRate}
        />
      ) : (
        <div className="yt-player-container">
          <div className="yt-player-aspect" style={{ background: 'var(--code-bg)', borderRadius: 4, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
            <span style={{ color: 'var(--text)', opacity: 0.4, fontSize: 13 }}>Paste a YouTube URL above to load the player</span>
          </div>
        </div>
      )}
      <TranscriptViewer
        key={`${loadedVideoId ?? 'empty'}-${loadCount}`}
        initialText={loadedText ?? undefined}
        initialDuration={loadedDuration ?? undefined}
        externalPosition={externalPosition}
        externalPlaying={ytPlaying}
        onScrub={handleScrub}
        onPlayingChange={setTranscriptPlaying}
        onSpeedChange={setPlaybackRate}
        maxSpeed={currentVideoId ? 2 : undefined}
        onSubtitleLoad={handleSubtitleLoad}
      />
    </div>
  )
}
