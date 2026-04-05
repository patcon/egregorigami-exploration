import { useState, useRef, useEffect } from 'react'
import TranscriptViewer from './TranscriptViewer'
import YoutubePlayerEmbed from './YoutubePlayerEmbed'
import { extractVideoId, computeExternalPosition } from './videoUtils'
import { useVideoKeyboardControls } from './useVideoKeyboardControls'
import { useYoutubeTranscript } from './useYoutubeTranscript'

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
  useEffect(() => {
    const videoId = extractVideoId(urlInput)
    const url = new URL(window.location.href)
    if (videoId) { url.searchParams.set('videoId', videoId) } else { url.searchParams.delete('videoId') }
    history.replaceState(null, '', url.toString())
  }, [urlInput])

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
    <div className="flex flex-col flex-1 min-h-0">
      <div className="sticky top-0 bg-bg z-[11] px-5 py-2.5 border-b border-border flex flex-col gap-1.5">
        <div className="flex gap-2">
          <input
            type="url"
            className="flex-1 py-1.5 px-2.5 border border-border rounded-md bg-code-bg text-text-h text-sm focus:outline-2 focus:outline-accent focus:outline-offset-[1px] disabled:opacity-50 disabled:cursor-not-allowed"
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
            className="py-1.5 px-3.5 rounded-md border-0 bg-accent text-white text-sm font-medium cursor-pointer whitespace-nowrap transition-opacity duration-150 hover:opacity-85 disabled:opacity-50 disabled:cursor-not-allowed"
            onClick={isProd ? () => window.open(transcriptToolUrl, '_blank') : handleLoad}
            disabled={isProd ? !currentVideoId : status === 'loading'}
          >
            {!isProd && status === 'loading' ? 'Loading…' : `Fetch Transcript${isProd ? ' ↗' : ''}`}
          </button>
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
        <YoutubePlayerEmbed
          videoId={currentVideoId}
          onTimeUpdate={setVideoTime}
          seekTo={seekTarget}
          playing={transcriptPlaying}
          onPlayStateChange={setYtPlaying}
          playbackRate={playbackRate}
        />
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
