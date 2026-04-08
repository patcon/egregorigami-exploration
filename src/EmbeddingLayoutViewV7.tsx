import { useState, useRef, useCallback, useEffect } from 'react'
import TranscriptViewer from './TranscriptViewer'
import YoutubePlayerEmbed from './YoutubePlayerEmbed'
import ScatterPlot3D from './ScatterPlot3D'
import ScatterPlot3DV5 from './ScatterPlot3DV5'
import ScatterPlot3DV6 from './ScatterPlot3DV6'
import type { CameraState } from './scatterTypes'
import { EMBEDDING_MODELS, type EmbeddingModelId } from './embedSegments'
import { useEmbeddingWorker } from './useEmbeddingWorker'
import { buildShareUrl, readShareParam } from './shareUrl'
import { detectAndParseSubtitle } from './subtitleParser'
import { extractVideoId, computeChunks, computeExternalPosition } from './videoUtils'
import { useVideoKeyboardControls } from './useVideoKeyboardControls'
import { useYoutubeTranscript } from './useYoutubeTranscript'
import { loadCached, saveCached } from './usePointsCache'
import { useUrlHistory } from './useUrlHistory'
import UrlHistoryInput from './UrlHistoryInput'

const isProd = import.meta.env.PROD

export default function EmbeddingLayoutViewV7() {
  const [urlInput, setUrlInput] = useState(() => {
    const qsVideoId = new URLSearchParams(window.location.search).get('videoId')
    if (qsVideoId) return `https://www.youtube.com/watch?v=${qsVideoId}`
    return localStorage.getItem('yt-url') ?? ''
  })
  const currentVideoId = extractVideoId(urlInput)
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
  const videoHidden = playbackRate > 2
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
  const { phase: embedPhase, runEmbedding, cancelEmbedding } = useEmbeddingWorker()
  const hasSharePoints = !!(readShareParam()?.points)
  const { history: urlHistory } = useUrlHistory(urlInput, currentVideoId)

  const [displayPoints, setDisplayPoints] = useState<[number,number,number][] | null>(null)
  const [displayMeta, setDisplayMeta] = useState<{ modelId: string; segmentCount: number } | null>(null)
  const [isRerunMode, setIsRerunMode] = useState(false)
  const pendingMetaRef = useRef<{ modelId: string; segmentCount: number } | null>(null)

  // Load cached embedding when video changes (skip if share URL already provides points)
  useEffect(() => {
    if (hasSharePoints) return
    if (!currentVideoId) { setDisplayPoints(null); setDisplayMeta(null); return }
    const cached = loadCached(currentVideoId)
    if (cached) {
      setDisplayPoints(cached.points)
      setDisplayMeta({ modelId: cached.modelId, segmentCount: cached.segmentCount })
    } else {
      setDisplayPoints(null)
      setDisplayMeta(null)
    }
    setIsRerunMode(false)
  }, [currentVideoId]) // eslint-disable-line react-hooks/exhaustive-deps

  // On successful embedding, update display and save to cache
  useEffect(() => {
    if (embedPhase.status === 'done' && currentVideoId && pendingMetaRef.current) {
      const meta = pendingMetaRef.current
      setDisplayPoints(embedPhase.points)
      setDisplayMeta(meta)
      setIsRerunMode(false)
      saveCached(currentVideoId, { points: embedPhase.points, ...meta })
      pendingMetaRef.current = null
    }
  }, [embedPhase.status]) // eslint-disable-line react-hooks/exhaustive-deps
  const [segments, setSegments] = useState<string[] | null>(null)
  const [shareCopied, setShareCopied] = useState(false)

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
      setVideoDuration(null)
      const { windowSize, overlapPct } = windowParamsRef.current
      setSegments(computeChunks(text, windowSize, overlapPct))
      setHasTranscriptText(true)
    },
    onSubtitleLoaded: ({ text }) => {
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
    if (params.text.trim()) setSegments(computeChunks(params.text, params.windowSize, params.overlapPct))
  }, [])

  const handleParamsBlur = useCallback(() => {
    const { windowSize, overlapPct, text } = windowParamsRef.current
    if (!text.trim()) return
    setSegments(computeChunks(text, windowSize, overlapPct))
  }, [])

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

  // Prevent pull-to-refresh and iOS bounce by locking html overflow for the lifetime of this view
  useEffect(() => {
    const html = document.documentElement
    const prev = html.style.overflow
    html.style.overflow = 'hidden'
    return () => { html.style.overflow = prev }
  }, [])

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
      if (shared.points) {
        setDisplayPoints(shared.points)
        setDisplayMeta(null) // share URLs don't carry embedding metadata
      }
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
      ...(displayPoints ? { points: displayPoints } : {}),
    }
    const url = buildShareUrl(payload, '#v7')
    navigator.clipboard.writeText(url).then(() => {
      setShareCopied(true)
      setTimeout(() => setShareCopied(false), 2000)
    })
  }

  // Keep ref in sync so cursor handler always sees latest segments
  useEffect(() => { segmentsRef.current = segments }, [segments])

  // When video becomes visible again (speed drops to ≤2), seek YouTube to transcript cursor position
  const videoHiddenPrevRef = useRef(false)
  useEffect(() => {
    if (!videoHidden && videoHiddenPrevRef.current && totalSecsRef.current) {
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
    videoHiddenPrevRef.current = videoHidden
  }, [videoHidden])

  const handleCursorChange = useCallback((wordIndex: number) => {
    currentWordIndexRef.current = wordIndex
    const segs = segmentsRef.current
    if (!segs || segs.length === 0) return
    const { windowSize, overlapPct, text } = windowParamsRef.current
    const words = text.trim().split(/\s+/).filter(Boolean)
    if (words.length === 0) return
    const step = Math.max(1, Math.round(windowSize * (1 - overlapPct / 100)))
    const initialCursor = Math.min(windowSize - 1, words.length - 1)
    const endIndices = segs.map((_, i) => {
      const cursor = Math.min(words.length - 1, initialCursor + i * step)
      const windowStart = Math.max(0, cursor - windowSize + 1)
      return Math.min(words.length - 1, windowStart + windowSize - 1)
    })
    if (wordIndex <= endIndices[0]) { setHighlightIndex(0); return }
    if (wordIndex >= endIndices[endIndices.length - 1]) { setHighlightIndex(segs.length - 1); return }
    for (let i = 0; i < endIndices.length - 1; i++) {
      if (wordIndex >= endIndices[i] && wordIndex < endIndices[i + 1]) {
        setHighlightIndex(i + (wordIndex - endIndices[i]) / (endIndices[i + 1] - endIndices[i]))
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
    setClickSeekPosition(words.length > 1 ? wordIndex / (words.length - 1) : 0)
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
  useEffect(() => { totalSecsRef.current = totalSecs })

  const [videoDuration, setVideoDuration] = useState<number | null>(null)
  const durationMismatch = videoDuration !== null && totalSecs !== null
    && Math.abs(videoDuration - totalSecs) > Math.max(10, totalSecs * 0.05)

  const [transcriptTab, setTranscriptTab] = useState(() => {
    if (hasSharePoints) return '3d'
    return !hasTranscriptText ? 'raw' : 'windowed'
  })
  useEffect(() => { if (durationMismatch) setTranscriptTab('raw') }, [durationMismatch])

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
    pendingMetaRef.current = { modelId: selectedModel, segmentCount: chunks.length }
    cameraStateRef.current = null
    runEmbeddingOnChunks(chunks)
  }

const isEmbedding = embedPhase.status === 'model-loading' || embedPhase.status === 'embedding' || embedPhase.status === 'umap-running'
  useEffect(() => { if (embedPhase.status === 'done') setTranscriptTab('3d') }, [embedPhase.status])

  const handleDownload = () => {
    if (!displayPoints) return
    const blob = new Blob([JSON.stringify(displayPoints)], { type: 'application/json' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = 'embeddings-3d.json'
    a.click()
    URL.revokeObjectURL(url)
  }

  const transcriptToolUrl = currentVideoId
    ? `https://www.youtube-transcript.io/videos?id=${currentVideoId}`
    : 'https://www.youtube-transcript.io'

  const [infoOpen, setInfoOpen] = useState(false)
  const infoDialogRef = useRef<HTMLDialogElement>(null)
  useEffect(() => {
    const dialog = infoDialogRef.current
    if (!dialog) return
    if (infoOpen) dialog.showModal()
    else dialog.close()
  }, [infoOpen])

  const [isDesktop, setIsDesktop] = useState(() => window.matchMedia('(min-width: 1024px)').matches)
  useEffect(() => {
    const mq = window.matchMedia('(min-width: 1024px)')
    const handler = (e: MediaQueryListEvent) => setIsDesktop(e.matches)
    mq.addEventListener('change', handler)
    return () => mq.removeEventListener('change', handler)
  }, [])
  // When switching to desktop, the '3d' tab doesn't exist in the bottom TranscriptViewer
  useEffect(() => {
    if (isDesktop && transcriptTab === '3d') setTranscriptTab('windowed')
  }, [isDesktop]) // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <div className="flex flex-col h-[100dvh] overflow-hidden overscroll-none">
      {/* Info modal */}
      <dialog
        ref={infoDialogRef}
        onClick={e => { if (e.target === infoDialogRef.current) setInfoOpen(false) }}
        className="backdrop:bg-black/40 rounded-xl border border-border bg-bg text-text p-6 w-[min(360px,90vw)] shadow-lg"
      >
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-base font-semibold m-0">About</h2>
          <button onClick={() => setInfoOpen(false)} className="text-text opacity-50 hover:opacity-100 bg-transparent border-0 text-xl cursor-pointer leading-none">×</button>
        </div>
        <a href="#index" onClick={() => setInfoOpen(false)} className="text-sm text-accent no-underline hover:underline">
          Version Index →
        </a>
      </dialog>

      {/* URL Bar */}
      <div className="flex-shrink-0 py-2.5 px-4 border-b border-border flex flex-col gap-1.5">
        <div className="flex gap-2 items-center">
          <button
            onClick={() => setInfoOpen(true)}
            className="flex-shrink-0 w-6 h-6 rounded-full border border-current flex items-center justify-center text-xs font-bold opacity-40 hover:opacity-80 bg-transparent cursor-pointer text-inherit"
            aria-label="About"
          >i</button>
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
          <button className="py-1.5 px-3.5 rounded-md border border-border bg-code-bg text-text-h text-[13px] cursor-pointer whitespace-nowrap hover:bg-border" onClick={handleShare}>
            {shareCopied ? 'Copied!' : 'Share'}
          </button>
        </div>
        {loadStatus === 'error' && <p className="text-[13px] text-[#e53e3e] m-0">{loadError}</p>}
      </div>

      {/* Shared content blocks */}
      {(() => {
        const videoBlock = currentVideoId ? (
          <div className="relative flex-shrink-0">
            <div style={{ visibility: videoHidden ? 'hidden' : 'visible' }}>
              <YoutubePlayerEmbed
                videoId={currentVideoId}
                onTimeUpdate={setVideoTime}
                seekTo={videoHidden ? undefined : seekTarget}
                playing={videoHidden ? false : transcriptPlaying}
                onPlayStateChange={videoHidden ? undefined : setYtPlaying}
                playbackRate={playbackRate}
                onVideoDuration={setVideoDuration}
                noBottomMargin={isDesktop}
              />
            </div>
            {videoHidden && (
              <div className="absolute inset-0 w-full max-w-[640px] mx-auto">
                <div className="yt-player-aspect relative w-full aspect-video bg-code-bg rounded flex items-center justify-center">
                  <span className="text-text opacity-40 text-[13px]">YouTube paused — playing faster than 2×</span>
                </div>
              </div>
            )}
          </div>
        ) : (
          <div className="w-full max-w-[640px] mx-auto flex-shrink-0">
            <div className="yt-player-aspect relative w-full aspect-video bg-code-bg rounded flex items-center justify-center">
              <span className="text-text opacity-40 text-[13px]">Paste a YouTube URL above to load the player</span>
            </div>
          </div>
        )

        const segmentsContent = segments && segments.length > 0 ? (
          <ul className="list-none p-0 m-0 overflow-y-auto overscroll-y-contain flex-1">
            {segments.map((seg, i) => (
              <li key={i} className="flex gap-2 py-2 px-3.5 border-b border-border text-[13px] items-start">
                <span className="text-text opacity-50 min-w-[28px] flex-shrink-0 text-right tabular-nums pt-[1px]">{i + 1}</span>
                <span className="text-text-h leading-[1.45]">{seg}</span>
              </li>
            ))}
          </ul>
        ) : (
          <div className="flex-1 flex items-center justify-center text-text opacity-40 text-sm p-8 text-center">
            Load a transcript to see segments.
          </div>
        )

        const threeDContent = displayPoints !== null ? (
          <div className="flex-1 min-h-0 flex flex-col overflow-hidden relative">
            {rendererType === 'original' && <ScatterPlot3D points={displayPoints} labels={segments ?? []} highlightPosition={highlightIndex} onPointClick={handlePointClick} initialCameraState={cameraStateRef.current ?? undefined} onCameraChange={s => { cameraStateRef.current = s }} />}
            {rendererType === 'cividis-tube' && <ScatterPlot3DV5 points={displayPoints} labels={segments ?? []} highlightPosition={highlightIndex} onPointClick={handlePointClick} initialCameraState={cameraStateRef.current ?? undefined} onCameraChange={s => { cameraStateRef.current = s }} />}
            {rendererType === 'glow' && <ScatterPlot3DV6 points={displayPoints} labels={segments ?? []} highlightPosition={highlightIndex} onPointClick={handlePointClick} initialCameraState={cameraStateRef.current ?? undefined} onCameraChange={s => { cameraStateRef.current = s }} />}
            {displayMeta && (
              <div className="absolute bottom-2 right-2 text-[11px] text-right pointer-events-none leading-tight select-none rounded px-1.5 py-1" style={{ background: 'rgba(0,0,0,0.45)', color: 'rgba(255,255,255,0.75)' }}>
                <div>{EMBEDDING_MODELS.find(m => m.id === displayMeta.modelId)?.label ?? displayMeta.modelId.split('/').pop()}</div>
                <div>{displayMeta.segmentCount} segments</div>
              </div>
            )}
          </div>
        ) : (
          <div className="flex-1 flex items-center justify-center text-text opacity-40 text-sm p-8 text-center">
            {isEmbedding ? 'Embedding in progress…' : 'Run Visualize to see segments in 3D.'}
          </div>
        )

        const transcriptKey = `${loadedVideoId ?? 'empty'}-${loadCount}`
        const transcriptViewerProps = {
          initialText: loadedText ?? undefined,
          initialDuration: loadedDuration ?? undefined,
          onWindowChange: handleWindowChange,
          onParamsBlur: handleParamsBlur,
          onCursorChange: handleCursorChange,
          externalPosition: (videoHidden ? undefined : externalPosition) ?? clickSeekPosition,
          externalPlaying: videoHidden ? undefined : ytPlaying,
          onScrub: handleScrub,
          onPlayingChange: setTranscriptPlaying,
          onSpeedChange: setPlaybackRate,
          hideSegmentsMode: true,
          onSubtitleLoad: handleSubtitleLoad,
          hideFileLoad: !isProd,
          tab: transcriptTab,
          onTabChange: setTranscriptTab,
          warning: durationMismatch ? `⚠ Transcript duration (${totalSecs}s) doesn't match video (${Math.round(videoDuration!)}s) — transcript may be out of date.` : undefined,
          prependTextareaButtons: (
            <button
              className="flex-shrink-0 py-1.5 px-3 rounded-md border-0 bg-accent text-white text-[13px] font-medium cursor-pointer whitespace-nowrap transition-opacity duration-150 hover:opacity-85 disabled:opacity-50 disabled:cursor-not-allowed"
              onClick={isProd ? () => window.open(transcriptToolUrl, '_blank') : handleLoad}
              disabled={isProd ? !currentVideoId : loadStatus === 'loading'}
            >
              {!isProd && loadStatus === 'loading' ? 'Loading…' : `Fetch${isProd ? ' ↗' : ''}`}
            </button>
          ),
        }

        if (isDesktop) {
          return (
            <>
              {/* Desktop: top row — video left, 3D right; height driven by aspect-video content */}
              <div className="flex flex-shrink-0 overflow-hidden">
                <div className="w-1/2 flex-shrink-0 overflow-hidden">
                  {videoBlock}
                </div>
                <div className="w-1/2 flex-shrink-0 overflow-hidden border-l border-border">
                  <div className="relative w-full aspect-video">
                    <div className="absolute inset-0 flex flex-col">
                      {threeDContent}
                    </div>
                  </div>
                </div>
              </div>
              {/* Desktop: bottom row — transcript tabs (Raw/Windowed/Segments) */}
              <div className="flex-1 min-h-0 border-t border-border flex flex-col overflow-hidden">
                <TranscriptViewer
                  key={transcriptKey}
                  {...transcriptViewerProps}
                  tab={transcriptTab === '3d' ? 'windowed' : transcriptTab}
                  extraTabs={[{ id: 'segments', label: 'Segments' }]}
                  extraTabContent={segmentsContent}
                />
              </div>
            </>
          )
        }

        return (
          /* Mobile/landscape: single flex column, splits to two columns at sm: */
          <div className="flex flex-1 min-h-0 overflow-hidden">
            <div className="flex-1 min-w-0 flex flex-col sm:flex-row overflow-hidden">
              <div className="flex-shrink-0 sm:w-1/2 sm:overflow-hidden">
                {videoBlock}
              </div>
              <div className="flex-1 min-h-0 min-w-0 flex flex-col overflow-hidden">
                <TranscriptViewer
                  key={transcriptKey}
                  {...transcriptViewerProps}
                  extraTabs={[
                    { id: 'segments', label: 'Segments' },
                    { id: '3d', label: '3D' },
                  ]}
                  extraTabContent={transcriptTab === 'segments' ? segmentsContent : threeDContent}
                />
              </div>
            </div>
          </div>
        )
      })()}

      {/* Bottom: embedding form */}
      <div className="flex-shrink-0 border-t border-border px-4 py-2.5 flex flex-col gap-2">
        {isEmbedding && (
          <div className="flex flex-col gap-1.5 text-[13px] text-text">
            {embedPhase.status === 'model-loading' && (
              <>
                <div className="flex items-center gap-2">
                  <div className="spinner" />
                  <span>{embedPhase.progress > 0 ? `Downloading model… ${embedPhase.progress}%` : 'Initializing model…'}</span>
                  <button className="ml-auto py-[3px] px-2.5 rounded border border-border bg-transparent text-text text-xs cursor-pointer opacity-70 hover:opacity-100" onClick={() => { cancelEmbedding(); setIsRerunMode(false) }}>Cancel</button>
                </div>
                <div className={`progress-bar ${embedPhase.progress === 0 ? 'progress-bar--indeterminate' : ''}`}>
                  <div className="progress-bar-fill" style={{ width: `${embedPhase.progress}%` }} />
                </div>
              </>
            )}
            {embedPhase.status === 'embedding' && (
              <>
                <div className="flex items-center gap-2">
                  <div className="spinner" />
                  <span>Embedding {embedPhase.loaded + 1} / {embedPhase.total}</span>
                  <button className="ml-auto py-[3px] px-2.5 rounded border border-border bg-transparent text-text text-xs cursor-pointer opacity-70 hover:opacity-100" onClick={() => { cancelEmbedding(); setIsRerunMode(false) }}>Cancel</button>
                </div>
                <div className="progress-bar">
                  <div className="progress-bar-fill" style={{ width: `${(embedPhase.loaded / embedPhase.total) * 100}%` }} />
                </div>
              </>
            )}
            {embedPhase.status === 'umap-running' && (
              <>
                <div className="flex items-center gap-2">
                  <div className="spinner" />
                  <span>Reducing to 3D…</span>
                  <button className="ml-auto py-[3px] px-2.5 rounded border border-border bg-transparent text-text text-xs cursor-pointer opacity-70 hover:opacity-100" onClick={() => { cancelEmbedding(); setIsRerunMode(false) }}>Cancel</button>
                </div>
                <div className="progress-bar progress-bar--indeterminate">
                  <div className="progress-bar-fill" />
                </div>
              </>
            )}
          </div>
        )}
        {!isEmbedding && (
          <div className="flex gap-2 items-center flex-wrap">
            {displayPoints && !isRerunMode ? (
              <>
                <button
                  className="py-1.5 px-3 rounded-md border border-border bg-code-bg text-text-h text-[13px] cursor-pointer whitespace-nowrap hover:bg-border"
                  onClick={() => setIsRerunMode(true)}
                >
                  Rerun Viz
                </button>
                <select
                  className="flex-1 py-1.5 px-2 border border-border rounded-md bg-code-bg text-text-h text-[13px] cursor-pointer focus:outline-2 focus:outline-accent focus:outline-offset-[1px]"
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
                <button className="py-1.5 px-2.5 rounded-md border border-border bg-code-bg text-text-h text-[13px] cursor-pointer whitespace-nowrap hover:bg-border" onClick={handleDownload} title="Download 3D points as JSON">
                  ⬇ <span className="sr-only">Download 3D points as JSON</span>
                </button>
              </>
            ) : (
              <>
                {isRerunMode && (
                  <button
                    className="py-1.5 px-2.5 rounded-md border border-border bg-code-bg text-text-h text-[13px] cursor-pointer whitespace-nowrap hover:bg-border"
                    onClick={() => setIsRerunMode(false)}
                    title="Cancel rerun"
                  >
                    ✕
                  </button>
                )}
                <select
                  className="flex-1 py-1.5 px-2 border border-border rounded-md bg-code-bg text-text-h text-[13px] cursor-pointer focus:outline-2 focus:outline-accent focus:outline-offset-[1px]"
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
                <button
                  className="py-1.5 px-3.5 rounded-md border-0 bg-accent text-white text-sm font-semibold cursor-pointer whitespace-nowrap hover:opacity-[0.88] disabled:opacity-50 disabled:cursor-not-allowed"
                  onClick={handleRunEmbedding}
                  disabled={!hasTranscriptText}
                >
                  Visualize
                </button>
              </>
            )}
          </div>
        )}
        {embedPhase.status === 'error' && (
          <p className="text-[#e53e3e] text-[13px] m-0 w-full">{embedPhase.message}</p>
        )}
      </div>
    </div>
  )
}
