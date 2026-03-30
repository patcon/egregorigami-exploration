import { useState, useRef, useCallback, useEffect } from 'react'
import TranscriptViewer from './TranscriptViewer'
import YoutubePlayerEmbed from './YoutubePlayerEmbed'
import SegmentProjectorModal from './SegmentProjectorModal'
import { extractVideoId, computeChunks, computeExternalPosition } from './videoUtils'
import { useVideoKeyboardControls } from './useVideoKeyboardControls'
import { useYoutubeTranscript } from './useYoutubeTranscript'
import './YoutubeTranscriptViewer.css'
import './YoutubeEmbeddingProjector.css'

const isProd = import.meta.env.PROD

export default function YoutubeEmbeddingProjector() {
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
  const [modalSegments, setModalSegments] = useState<string[] | null>(null)
  const [videoTime, setVideoTime] = useState(0)
  const [seekTarget, setSeekTarget] = useState<number | undefined>(undefined)
  const [transcriptPlaying, setTranscriptPlaying] = useState(false)
  const [ytPlaying, setYtPlaying] = useState(false)
  const [playbackRate, setPlaybackRate] = useState(1)
  const [allowFaster, setAllowFaster] = useState(false)
  const videoTimeRef = useRef(0)
  useEffect(() => { videoTimeRef.current = videoTime }, [videoTime])

  useVideoKeyboardControls(videoTimeRef, setVideoTime, setSeekTarget, setYtPlaying)

  // Track current window params from TranscriptViewer without re-renders
  const windowParamsRef = useRef<{ windowSize: number; overlapPct: number; text: string }>({
    windowSize: 40,
    overlapPct: 80,
    text: loadedText ?? '',
  })

  const [hasTranscriptText, setHasTranscriptText] = useState(() => !!(loadedText?.trim()))

  const handleWindowChange = useCallback((params: { windowSize: number; overlapPct: number; text: string }) => {
    windowParamsRef.current = params
    setHasTranscriptText(!!params.text.trim())
  }, [])

  const totalSecs = loadedDuration ? parseInt(loadedDuration) : null
  const externalPosition = computeExternalPosition(videoTime, wordTimestamps, totalSecs)

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

      {currentVideoId ? (
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
            <div className="yt-player-container" style={{ position: 'absolute', top: 0, bottom: 0, left: 0, right: 0, margin: '0 auto' }}>
              <div className="yt-player-aspect" style={{ background: 'var(--code-bg)', borderRadius: 4, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                <span style={{ color: 'var(--text)', opacity: 0.4, fontSize: 13 }}>YouTube paused — allow faster enabled</span>
              </div>
            </div>
          )}
        </div>
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
        onWindowChange={handleWindowChange}
        externalPosition={externalPosition}
        externalPlaying={ytPlaying}
        onScrub={handleScrub}
        onPlayingChange={setTranscriptPlaying}
        onSpeedChange={setPlaybackRate}
        maxSpeed={currentVideoId ? 2 : undefined}
        onAllowFasterChange={allow => { setAllowFaster(allow); if (!allow) { setYtPlaying(false); setTranscriptPlaying(false) } }}
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
