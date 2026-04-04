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
import { buildShareUrl, readShareParam } from './shareUrl'
import { detectAndParseSubtitle } from './subtitleParser'
import { extractVideoId, computeChunks, computeExternalPosition } from './videoUtils'
import { useVideoKeyboardControls } from './useVideoKeyboardControls'
import { useYoutubeTranscript } from './useYoutubeTranscript'
import './YoutubeTranscriptViewer.css'
import './SegmentProjectorModal.css'
import './EmbeddingLayoutView.css'

const isProd = import.meta.env.PROD

export default function EmbeddingLayoutViewV5() {
  const [urlInput, setUrlInput] = useState(() => {
    const qsVideoId = new URLSearchParams(window.location.search).get('videoId')
    if (qsVideoId) return `https://www.youtube.com/watch?v=${qsVideoId}`
    return localStorage.getItem('yt-url') ?? ''
  })
  useEffect(() => {
    const videoId = extractVideoId(urlInput)
    const url = new URL(window.location.href)
    if (videoId) { url.searchParams.set('videoId', videoId) } else { url.searchParams.delete('videoId') }
    history.replaceState(null, '', url.toString())
  }, [urlInput])

  const [videoTime, setVideoTime] = useState(0)
  const [seekTarget, setSeekTarget] = useState<number | undefined>(undefined)
  const [transcriptPlaying, setTranscriptPlaying] = useState(false)
  const [ytPlaying, setYtPlaying] = useState(false)
  const [playbackRate, setPlaybackRate] = useState(1)
  const [allowFaster, setAllowFaster] = useState(false)
  const [hasTranscriptText, setHasTranscriptText] = useState(() => !!(localStorage.getItem('yt-transcript')?.trim()))

  const windowParamsRef = useRef<{ windowSize: number; overlapPct: number; text: string }>({
    windowSize: 40,
    overlapPct: 80,
    text: localStorage.getItem('yt-transcript') ?? '',
  })

  // Embedding state — declared early so callbacks below can reference resetEmbedPhase/setSegments
  const [selectedModel, setSelectedModel] = useState<EmbeddingModelId>(() => {
    const stored = localStorage.getItem('projector-model')
    return (EMBEDDING_MODELS.find(m => m.id === stored) ?? EMBEDDING_MODELS.find(m => m.default)!).id
  })
  const { phase: embedPhase, runEmbedding, cancelEmbedding, resetPhase: resetEmbedPhase, restorePoints } = useEmbeddingWorker()
  const [segments, setSegments] = useState<string[] | null>(null)
  const [shareCopied, setShareCopied] = useState(false)
  const [showSegmentsModal, setShowSegmentsModal] = useState(false)

  type RendererType = 'original' | 'cividis-tube' | 'glow'
  const [rendererType, setRendererType] = useState<RendererType>(() =>
    (localStorage.getItem('scatter-renderer') as RendererType) ?? 'cividis-tube'
  )

  const {
    loadedText, loadedDuration, loadedVideoId, wordTimestamps, loadCount,
    status, errorMessage: loadError, handleLoad, handleSubtitleLoad,
    setLoadedText, setLoadedDuration, setLoadedVideoId, setWordTimestamps, setLoadCount,
  } = useYoutubeTranscript(urlInput, {
    onLoaded: ({ text }) => {
      resetEmbedPhase()
      const { windowSize, overlapPct } = windowParamsRef.current
      setSegments(computeChunks(text, windowSize, overlapPct))
      setHasTranscriptText(true)
    },
    onSubtitleLoaded: ({ text }) => {
      resetEmbedPhase()
      const { windowSize, overlapPct } = windowParamsRef.current
      setSegments(computeChunks(text, windowSize, overlapPct))
      setHasTranscriptText(true)
    },
  })

  // Alias to match original variable name used in JSX
  const loadStatus = status

  const handleWindowChange = useCallback((params: { windowSize: number; overlapPct: number; text: string }) => {
    windowParamsRef.current = params
    setHasTranscriptText(!!params.text.trim())
  }, [])

  const handleParamsBlur = useCallback(() => {
    const { windowSize, overlapPct, text } = windowParamsRef.current
    if (!text.trim()) return
    setSegments(computeChunks(text, windowSize, overlapPct))
  }, [])

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

  useVideoKeyboardControls(videoTimeRef, setVideoTime, setSeekTarget, setYtPlaying)

  // Restore from share URL on mount
  useEffect(() => {
    const shared = readShareParam()
    if (!shared) return
    if (shared.modelId) { setSelectedModel(shared.modelId as EmbeddingModelId); localStorage.setItem('projector-model', shared.modelId) }
    if (shared.rendererType) { setRendererType(shared.rendererType as RendererType); localStorage.setItem('scatter-renderer', shared.rendererType) }
    if (shared.videoId) setUrlInput(`https://www.youtube.com/watch?v=${shared.videoId}`)
    if (shared.rawText) {
      const parsed = detectAndParseSubtitle(shared.rawText)
      const processedText = parsed?.text ?? shared.rawText
      const duration = parsed?.durationSecs ? String(parsed.durationSecs) : null
      localStorage.setItem('transcript-raw-text', shared.rawText)
      localStorage.setItem('transcript-text', processedText)
      localStorage.setItem('yt-transcript', processedText)
      if (duration) localStorage.setItem('yt-duration', duration)
      setLoadedText(processedText)
      if (duration) setLoadedDuration(duration)
      setLoadCount(c => c + 1)
      windowParamsRef.current = { ...windowParamsRef.current, windowSize: shared.windowSize, overlapPct: shared.overlapPct, text: processedText }
      setHasTranscriptText(true)
      const chunks = computeChunks(processedText, shared.windowSize, shared.overlapPct)
      setSegments(chunks)
      if (shared.points) restorePoints(shared.points)
    }
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  const handleShare = () => {
    const { windowSize, overlapPct } = windowParamsRef.current
    const videoId = extractVideoId(urlInput) ?? undefined
    const payload = {
      windowSize, overlapPct, videoId,
      modelId: selectedModel,
      rendererType,
      ...(localStorage.getItem('transcript-raw-text') ? { rawText: localStorage.getItem('transcript-raw-text')! } : {}),
      ...(embedPhase.status === 'done' ? { points: embedPhase.points } : {}),
    }
    const url = buildShareUrl(payload, '#v5')
    navigator.clipboard.writeText(url).then(() => {
      setShareCopied(true)
      setTimeout(() => setShareCopied(false), 2000)
    })
  }

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

  const totalSecs = loadedDuration ? parseInt(loadedDuration) : null
  totalSecsRef.current = totalSecs

  const externalPosition = computeExternalPosition(videoTime, wordTimestamps, totalSecs)

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

  const handleDownload = () => {
    if (embedPhase.status !== 'done') return
    const blob = new Blob([JSON.stringify(embedPhase.points)], { type: 'application/json' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = 'embeddings-3d.json'
    a.click()
    URL.revokeObjectURL(url)
  }

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
          <button className="show-segments-btn" onClick={handleShare}>
            {shareCopied ? 'Copied!' : 'Share'}
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
                  <button className="show-segments-btn" onClick={handleDownload} title="Download 3D points as JSON">
                    ⬇ <span style={{ position: 'absolute', width: 1, height: 1, overflow: 'hidden', clip: 'rect(0,0,0,0)', whiteSpace: 'nowrap' }}>Download 3D points as JSON</span>
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
