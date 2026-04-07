import { useState, useRef, useCallback, useEffect } from 'react'
import TranscriptViewer from './TranscriptViewer'
import YoutubePlayerEmbed from './YoutubePlayerEmbed'
import SegmentProjectorModal from './SegmentProjectorModal'
import { extractVideoId, computeChunks, computeExternalPosition } from './videoUtils'
import { useVideoKeyboardControls } from './useVideoKeyboardControls'
import { useYoutubeTranscript } from './useYoutubeTranscript'
import { useUrlHistory } from './useUrlHistory'
import UrlHistoryInput from './UrlHistoryInput'

const isProd = import.meta.env.PROD

export default function YoutubeEmbeddingProjector() {
  const [urlInput, setUrlInput] = useState(() => {
    const qsVideoId = new URLSearchParams(window.location.search).get('videoId')
    if (qsVideoId) return `https://www.youtube.com/watch?v=${qsVideoId}`
    return localStorage.getItem('yt-url') ?? ''
  })
  const currentVideoId = extractVideoId(urlInput)
  const { history: urlHistory } = useUrlHistory(urlInput, currentVideoId)
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
  useEffect(() => {
    const videoId = extractVideoId(urlInput)
    const url = new URL(window.location.href)
    if (videoId) { url.searchParams.set('videoId', videoId) } else { url.searchParams.delete('videoId') }
    history.replaceState(null, '', url.toString())
  }, [urlInput])

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

  const transcriptToolUrl = currentVideoId
    ? `https://www.youtube-transcript.io/videos?id=${currentVideoId}`
    : 'https://www.youtube-transcript.io'

  const handleOpenProjector = () => {
    const { windowSize, overlapPct, text } = windowParamsRef.current
    const chunks = computeChunks(text, windowSize, overlapPct)
    setModalSegments(chunks)
  }

  return (
    <div className="flex flex-col flex-1 min-h-0">
      <div className="sticky top-0 bg-bg z-[11] px-5 py-2.5 border-b border-border flex flex-col gap-1.5">
        <div className="flex gap-2">
          <UrlHistoryInput
            value={urlInput}
            onChange={val => {
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
            history={urlHistory}
          />
          <button className="py-1.5 px-3.5 rounded-md border-0 bg-accent text-white text-sm font-medium cursor-pointer whitespace-nowrap transition-opacity duration-150 hover:opacity-85 disabled:opacity-50 disabled:cursor-not-allowed"
            onClick={isProd ? () => window.open(transcriptToolUrl, '_blank') : handleLoad}
            disabled={isProd ? !currentVideoId : status === 'loading'}>
            {!isProd && status === 'loading' ? 'Loading…' : `Fetch Transcript${isProd ? ' ↗' : ''}`}
          </button>
          {hasTranscriptText && (
            <button className="py-1.5 px-3.5 rounded-md border-0 bg-accent text-white text-sm font-semibold cursor-pointer whitespace-nowrap hover:opacity-[0.88]" onClick={handleOpenProjector}>
              Open Projector
            </button>
          )}
        </div>
        {status === 'error' && <p className="text-[13px] text-[#e53e3e] m-0">{errorMessage}</p>}
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
        <div className="relative">
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
            <div className="yt-player-container absolute inset-0 w-full max-w-[640px] mx-auto">
              <div className="yt-player-aspect relative w-full aspect-video bg-code-bg rounded flex items-center justify-center">
                <span className="text-text opacity-40 text-[13px]">YouTube paused — allow faster enabled</span>
              </div>
            </div>
          )}
        </div>
      ) : (
        <div className="w-full max-w-[640px] mx-auto mb-4">
          <div className="yt-player-aspect relative w-full aspect-video bg-code-bg rounded flex items-center justify-center">
            <span className="text-text opacity-40 text-[13px]">Paste a YouTube URL above to load the player</span>
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
          videoId={currentVideoId}
        />
      )}
    </div>
  )
}
