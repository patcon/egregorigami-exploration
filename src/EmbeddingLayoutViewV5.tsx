import { useState, useRef, useCallback, useEffect } from 'react'
import TranscriptViewer from './TranscriptViewer'
import YoutubePlayerEmbed from './YoutubePlayerEmbed'
import ScatterPlot3D from './ScatterPlot3D'
import ScatterPlot3DV5 from './ScatterPlot3DV5'
import ScatterPlot3DV6 from './ScatterPlot3DV6'
import type { CameraState } from './scatterTypes'
import SegmentsListModal from './SegmentsListModal'
import { EMBEDDING_MODELS, type EmbeddingModelId } from './embedSegments'
import { useEmbeddingWorker } from './useEmbeddingWorker'
import { buildTranscriptData, segmentsToVtt } from './subtitleParser'
import './YoutubeTranscriptViewer.css'
import './SegmentProjectorModal.css'
import './EmbeddingLayoutView.css'

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
  for (let cursor = Math.min(windowSize - 1, words.length - 1); cursor < words.length; cursor += step) {
    const windowStart = Math.max(0, cursor - windowSize + 1)
    chunks.push(words.slice(windowStart, windowStart + windowSize).join(' '))
  }
  return chunks
}

const isProd = import.meta.env.PROD

export default function EmbeddingLayoutViewV5() {
  const [urlInput, setUrlInput] = useState(() => {
    const qsVideoId = new URLSearchParams(window.location.search).get('videoId')
    if (qsVideoId) return `https://www.youtube.com/watch?v=${qsVideoId}`
    return localStorage.getItem('yt-url') ?? ''
  })
  const [loadedText, setLoadedText] = useState<string | null>(() => localStorage.getItem('yt-transcript'))
  const [loadedDuration, setLoadedDuration] = useState<string | null>(() => localStorage.getItem('yt-duration'))
  const [loadedVideoId, setLoadedVideoId] = useState<string | null>(() =>
    extractVideoId(localStorage.getItem('yt-url') ?? '') ? localStorage.getItem('yt-video-id') : null
  )
  const [loadCount, setLoadCount] = useState(0)
  const [loadStatus, setLoadStatus] = useState<'idle' | 'loading' | 'error'>('idle')
  const [loadError, setLoadError] = useState('')
  const [wordTimestamps, setWordTimestamps] = useState<number[] | null>(
    () => JSON.parse(localStorage.getItem('yt-word-timestamps') ?? 'null')
  )
  const [videoTime, setVideoTime] = useState(0)
  const [seekTarget, setSeekTarget] = useState<number | undefined>(undefined)
  const [transcriptPlaying, setTranscriptPlaying] = useState(false)
  const [ytPlaying, setYtPlaying] = useState(false)
  const [playbackRate, setPlaybackRate] = useState(1)
  const [allowFaster, setAllowFaster] = useState(false)

  const [hasTranscriptText, setHasTranscriptText] = useState(() => !!(loadedText?.trim()))
  const windowParamsRef = useRef<{ windowSize: number; overlapPct: number; text: string }>({
    windowSize: 40,
    overlapPct: 80,
    text: loadedText ?? '',
  })

  const handleWindowChange = useCallback((params: { windowSize: number; overlapPct: number; text: string }) => {
    windowParamsRef.current = params
    setHasTranscriptText(!!params.text.trim())
  }, [])

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
    resetEmbedPhase()
    const { windowSize, overlapPct } = windowParamsRef.current
    setSegments(computeChunks(result.text, windowSize, overlapPct))
  }, [])

  const handleParamsBlur = useCallback(() => {
    const { windowSize, overlapPct, text } = windowParamsRef.current
    if (!text.trim()) return
    setSegments(computeChunks(text, windowSize, overlapPct))
  }, [])

  // Embedding state
  const [selectedModel, setSelectedModel] = useState<EmbeddingModelId>(() => {
    const stored = localStorage.getItem('projector-model')
    return (EMBEDDING_MODELS.find(m => m.id === stored) ?? EMBEDDING_MODELS.find(m => m.default)!).id
  })
  const { phase: embedPhase, runEmbedding, cancelEmbedding, resetPhase: resetEmbedPhase } = useEmbeddingWorker()
  const [segments, setSegments] = useState<string[] | null>(null)
  const [showSegmentsModal, setShowSegmentsModal] = useState(false)

  type RendererType = 'original' | 'cividis-tube' | 'glow'
  const [rendererType, setRendererType] = useState<RendererType>(() =>
    (localStorage.getItem('scatter-renderer') as RendererType) ?? 'cividis-tube'
  )

  // Scatter highlight state
  const [highlightIndex, setHighlightIndex] = useState<number | null>(null)
  const [clickSeekPosition, setClickSeekPosition] = useState<number | undefined>(undefined)
  const segmentsRef = useRef<string[] | null>(null)
  const cameraStateRef = useRef<CameraState | null>(null)
  const currentWordIndexRef = useRef(0)
  const wordTimestampsRef = useRef(wordTimestamps)
  useEffect(() => { wordTimestampsRef.current = wordTimestamps }, [wordTimestamps])
  const totalSecsRef = useRef<number | null>(null)
  const videoTimeRef = useRef(0)
  useEffect(() => { videoTimeRef.current = videoTime }, [videoTime])

  // Global keyboard controls: space=play/pause, arrows=seek ±10s
  useEffect(() => {
    const SEEK_DELTA = 10
    const handler = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement
      if (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.isContentEditable) return
      if (e.key === ' ') {
        e.preventDefault()
        setYtPlaying(p => !p)
      } else if (e.key === 'ArrowRight') {
        e.preventDefault()
        const newT = videoTimeRef.current + SEEK_DELTA
        setVideoTime(newT)
        setSeekTarget(newT)
      } else if (e.key === 'ArrowLeft') {
        e.preventDefault()
        const newT = Math.max(0, videoTimeRef.current - SEEK_DELTA)
        setVideoTime(newT)
        setSeekTarget(newT)
      }
    }
    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [])

  // Keep ref in sync so cursor handler always sees latest segments
  useEffect(() => { segmentsRef.current = segments }, [segments])

  // When re-enabling YouTube player, seek it to where the transcript cursor ended up
  const allowFasterPrevRef = useRef(false)
  useEffect(() => {
    if (!allowFaster && allowFasterPrevRef.current && totalSecsRef.current) {
      const totalSecs = totalSecsRef.current
      const wordIndex = currentWordIndexRef.current
      const ts = wordTimestampsRef.current
      const seekTime = ts && ts.length > 0
        ? ts[Math.min(wordIndex, ts.length - 1)]
        : (windowParamsRef.current.text.trim().split(/\s+/).filter(Boolean).length > 0
            ? (wordIndex / windowParamsRef.current.text.trim().split(/\s+/).filter(Boolean).length) * totalSecs
            : 0)
      setVideoTime(seekTime)
      if (seekTime > 0) setSeekTarget(seekTime)
    }
    allowFasterPrevRef.current = allowFaster
  }, [allowFaster])

  const handleCursorChange = useCallback((wordIndex: number) => {
    currentWordIndexRef.current = wordIndex
    const segs = segmentsRef.current
    if (!segs || segs.length === 0) return
    const { windowSize, overlapPct, text } = windowParamsRef.current
    const words = text.trim().split(/\s+/).filter(Boolean)
    if (words.length === 0) return
    const step = Math.max(1, Math.round(windowSize * (1 - overlapPct / 100)))
    const initialCursor = Math.min(windowSize - 1, words.length - 1)

    // Compute end word index for each segment
    const endIndices = segs.map((_, i) => {
      const cursor = Math.min(words.length - 1, initialCursor + i * step)
      const windowStart = Math.max(0, cursor - windowSize + 1)
      return Math.min(words.length - 1, windowStart + windowSize - 1)
    })

    // Interpolate: find the two adjacent segments whose ends bracket wordIndex
    if (wordIndex <= endIndices[0]) {
      setHighlightIndex(0)
      return
    }
    if (wordIndex >= endIndices[endIndices.length - 1]) {
      setHighlightIndex(segs.length - 1)
      return
    }
    for (let i = 0; i < endIndices.length - 1; i++) {
      if (wordIndex >= endIndices[i] && wordIndex < endIndices[i + 1]) {
        const t = (wordIndex - endIndices[i]) / (endIndices[i + 1] - endIndices[i])
        setHighlightIndex(i + t)
        return
      }
    }
  }, [])

  const handlePointClick = useCallback((idx: number) => {
    setHighlightIndex(idx)
    const { windowSize, overlapPct, text } = windowParamsRef.current
    const words = text.trim().split(/\s+/).filter(Boolean)
    if (words.length === 0) return
    const step = Math.max(1, Math.round(windowSize * (1 - overlapPct / 100)))
    const initialCursor = Math.min(windowSize - 1, words.length - 1)
    const wordIndex = Math.min(words.length - 1, initialCursor + idx * step)
    // Always set a direct word-index position so the transcript cursor jumps
    // even when no video is loaded (externalPosition would otherwise be undefined)
    setClickSeekPosition(words.length > 1 ? wordIndex / (words.length - 1) : 0)
    // Also seek the video if available
    const secs = totalSecsRef.current
    if (!secs) return
    const ts = wordTimestampsRef.current
    const seekTime = ts && ts.length > 0
      ? ts[Math.min(wordIndex, ts.length - 1)]
      : (words.length > 1 ? (wordIndex / (words.length - 1)) * secs : 0)
    setVideoTime(seekTime)
    setSeekTarget(seekTime)
  }, [])

  const handleLoad = async () => {
    const videoId = extractVideoId(urlInput)
    if (!videoId) {
      setLoadStatus('error')
      setLoadError('Could not extract a video ID from the input.')
      return
    }
    setLoadStatus('loading')
    setLoadError('')
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
      localStorage.setItem('transcript-raw-text', segmentsToVtt(data.segments))
      setLoadStatus('idle')
      // Reset embedding state when new transcript loaded
      resetEmbedPhase()
      const { windowSize, overlapPct } = windowParamsRef.current
      setSegments(computeChunks(text, windowSize, overlapPct))
    } catch (e) {
      setLoadStatus('error')
      setLoadError(String(e))
    }
  }

  const totalSecs = loadedDuration ? parseInt(loadedDuration) : null
  totalSecsRef.current = totalSecs

  const externalPosition = (() => {
    if (!totalSecs) return undefined
    if (wordTimestamps && wordTimestamps.length > 1) {
      if (videoTime < wordTimestamps[0]) return 0
      let segFirstIdx = 0
      for (let i = 1; i < wordTimestamps.length; i++) {
        if (wordTimestamps[i] > videoTime) break
        if (wordTimestamps[i] > wordTimestamps[i - 1]) segFirstIdx = i
      }
      let segLastIdx = segFirstIdx
      while (segLastIdx + 1 < wordTimestamps.length && wordTimestamps[segLastIdx + 1] === wordTimestamps[segFirstIdx]) {
        segLastIdx++
      }
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

  const runEmbeddingOnChunks = (chunks: string[]) => {
    if (chunks.length === 0) return
    runEmbedding(chunks, selectedModel)
  }

  const handleRunEmbedding = () => {
    const { windowSize, overlapPct, text } = windowParamsRef.current
    const chunks = computeChunks(text, windowSize, overlapPct)
    setSegments(chunks)
    cameraStateRef.current = null
    runEmbeddingOnChunks(chunks)
  }

  const handleShowSegments = () => {
    const { windowSize, overlapPct, text } = windowParamsRef.current
    const chunks = computeChunks(text, windowSize, overlapPct)
    setSegments(chunks)
    setShowSegmentsModal(true)
  }

  const isEmbedding = embedPhase.status === 'model-loading' || embedPhase.status === 'embedding' || embedPhase.status === 'umap-running'
  const isDone = embedPhase.status === 'done'

  const currentVideoId = extractVideoId(urlInput)
  const transcriptToolUrl = currentVideoId
    ? `https://www.youtube-transcript.io/videos?id=${currentVideoId}`
    : 'https://www.youtube-transcript.io'

  return (
    <div className="embedding-layout-wrapper">
      {/* URL Bar */}
      <div className="embedding-layout-bar">
        <div className="embedding-layout-row">
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
            disabled={isProd ? !currentVideoId : loadStatus === 'loading'}>
            {!isProd && loadStatus === 'loading' ? 'Loading…' : `Fetch Transcript${isProd ? ' ↗' : ''}`}
          </button>
        </div>
        {loadStatus === 'error' && <p className="youtube-error">{loadError}</p>}
        {isProd && (
          <p className="youtube-notice">
            {currentVideoId
              ? <>Paste or load the downloaded transcript below. VTT or SRT preferred — copied plaintext lacks timing and will degrade the experience.</>
              : <>Paste a YouTube URL above to get started.</>
            }
          </p>
        )}
      </div>

      {/* Main panels */}
      <div className="embedding-layout-panels">
        {/* Left: video + transcript */}
        <div className="embedding-layout-left">
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
            onParamsBlur={handleParamsBlur}
            onCursorChange={handleCursorChange}
            onAllowFasterChange={allow => { setAllowFaster(allow); if (!allow) { setYtPlaying(false); setTranscriptPlaying(false) } }}
            externalPosition={(allowFaster ? undefined : externalPosition) ?? clickSeekPosition}
            externalPlaying={allowFaster ? undefined : ytPlaying}
            onScrub={handleScrub}
            onPlayingChange={setTranscriptPlaying}
            onSpeedChange={setPlaybackRate}
            maxSpeed={currentVideoId ? 2 : undefined}
            onSubtitleLoad={handleSubtitleLoad}
          />
        </div>

        {/* Right: embedding panel */}
        <div className="embedding-layout-right">
          {/* No transcript yet */}
          {!hasTranscriptText && (
            <div className="embedding-panel-placeholder">
              <span>Load a YouTube video to enable embedding.</span>
            </div>
          )}

          {/* Transcript available, not yet embedded */}
          {hasTranscriptText && !isDone && !isEmbedding && (
            <>
              <div className="embedding-panel-form">
                <select
                  className="model-select"
                  value={selectedModel}
                  onChange={e => {
                    const v = e.target.value as EmbeddingModelId
                    setSelectedModel(v)
                    localStorage.setItem('projector-model', v)
                  }}
                >
                  {EMBEDDING_MODELS.map(m => (
                    <option key={m.id} value={m.id}>{m.label}</option>
                  ))}
                </select>
                <div className="embedding-panel-form-row">
                  <button
                    className="run-embedding-btn"
                    onClick={handleRunEmbedding}
                  >
                    Run Embedding
                  </button>
                  <button className="show-segments-btn" onClick={handleShowSegments}>
                    Show Segments{segments ? ` (${segments.length})` : ''}
                  </button>
                </div>
                {embedPhase.status === 'error' && (
                  <p className="embedding-panel-error">{embedPhase.message}</p>
                )}
              </div>
              {!segments && (
                <div className="embedding-panel-placeholder">
                  <span>Run embedding to visualize segment relationships in 3D.</span>
                </div>
              )}
            </>
          )}

          {/* Embedding in progress */}
          {isEmbedding && (
            <div className="embedding-panel-progress">
              {embedPhase.status === 'model-loading' && (
                <div className="progress-wrap" style={{ width: '100%', maxWidth: 300 }}>
                  <div className="progress-label">
                    <div className="spinner" />
                    <span>{embedPhase.progress > 0 ? `Downloading model… ${embedPhase.progress}%` : 'Initializing model…'}</span>
                    <button className="cancel-btn" onClick={cancelEmbedding}>Cancel</button>
                  </div>
                  <div className={`progress-bar ${embedPhase.progress === 0 ? 'progress-bar--indeterminate' : ''}`}>
                    <div className="progress-bar-fill" style={{ width: `${embedPhase.progress}%` }} />
                  </div>
                </div>
              )}
              {embedPhase.status === 'embedding' && (
                <div className="progress-wrap" style={{ width: '100%', maxWidth: 300 }}>
                  <div className="progress-label">
                    <div className="spinner" />
                    <span>Embedding {embedPhase.loaded + 1} / {embedPhase.total}</span>
                    <button className="cancel-btn" onClick={cancelEmbedding}>Cancel</button>
                  </div>
                  <div className="progress-bar">
                    <div className="progress-bar-fill" style={{ width: `${(embedPhase.loaded / embedPhase.total) * 100}%` }} />
                  </div>
                </div>
              )}
              {embedPhase.status === 'umap-running' && (
                <div className="progress-wrap" style={{ width: '100%', maxWidth: 300 }}>
                  <div className="progress-label">
                    <div className="spinner" />
                    <span>Reducing to 3D…</span>
                    <button className="cancel-btn" onClick={cancelEmbedding}>Cancel</button>
                  </div>
                  <div className="progress-bar progress-bar--indeterminate">
                    <div className="progress-bar-fill" />
                  </div>
                </div>
              )}
            </div>
          )}

          {/* Embedding done */}
          {isDone && embedPhase.status === 'done' && segments && (
            <>
              <div className="embedding-panel-form" style={{ flexShrink: 0 }}>
                <select
                  className="model-select"
                  value={selectedModel}
                  onChange={e => {
                    const v = e.target.value as EmbeddingModelId
                    setSelectedModel(v)
                    localStorage.setItem('projector-model', v)
                  }}
                >
                  {EMBEDDING_MODELS.map(m => (
                    <option key={m.id} value={m.id}>{m.label}</option>
                  ))}
                </select>
                <select
                  className="model-select"
                  value={rendererType}
                  onChange={e => {
                    const v = e.target.value as RendererType
                    setRendererType(v)
                    localStorage.setItem('scatter-renderer', v)
                  }}
                >
                  <option value="original">Points + Line</option>
                  <option value="cividis-tube">Cividis Tube</option>
                  <option value="glow">Glow (Shader)</option>
                </select>
                <div className="embedding-panel-form-row">
                  <button className="show-segments-btn" onClick={handleShowSegments}>
                    Show Segments ({segments.length})
                  </button>
                  <button
                    className="run-embedding-btn"
                    onClick={handleRunEmbedding}
                  >
                    Run Embedding
                  </button>
                </div>
              </div>
              <div className="embedding-panel-scatter">
                {rendererType === 'original' && <ScatterPlot3D points={embedPhase.points} labels={segments} highlightPosition={highlightIndex} onPointClick={handlePointClick} initialCameraState={cameraStateRef.current ?? undefined} onCameraChange={s => { cameraStateRef.current = s }} />}
                {rendererType === 'cividis-tube' && <ScatterPlot3DV5 points={embedPhase.points} labels={segments} highlightPosition={highlightIndex} onPointClick={handlePointClick} initialCameraState={cameraStateRef.current ?? undefined} onCameraChange={s => { cameraStateRef.current = s }} />}
                {rendererType === 'glow' && <ScatterPlot3DV6 points={embedPhase.points} labels={segments} highlightPosition={highlightIndex} onPointClick={handlePointClick} initialCameraState={cameraStateRef.current ?? undefined} onCameraChange={s => { cameraStateRef.current = s }} />}
              </div>
            </>
          )}
        </div>
      </div>

      {showSegmentsModal && segments && (
        <SegmentsListModal
          segments={segments}
          onClose={() => setShowSegmentsModal(false)}
        />
      )}
    </div>
  )
}
