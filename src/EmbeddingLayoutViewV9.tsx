import { useState, useRef, useCallback, useEffect, useMemo } from 'react'
import TranscriptViewer from './TranscriptViewer'
import YoutubePlayerEmbed from './YoutubePlayerEmbed'
import ScatterPlot3DMulti from './ScatterPlot3DMulti'
import type { LiveRenderer } from './livePathVisuals'
import RendererToggle from './RendererToggle'
import { DEFAULT_LINE_WIDTH, DEFAULT_NODE_SIZE } from './ScatterPlot3DLive'
import { useLiveEmbedding } from './useLiveEmbedding'
import type { CameraState } from './scatterTypes'
import { EMBEDDING_MODELS, type EmbeddingModelId } from './embedSegments'
import { extractVideoId, computeChunks, computeExternalPosition } from './videoUtils'
import { useYoutubeTranscript } from './useYoutubeTranscript'
import { detectAndParseSubtitle } from './subtitleParser'
import { useUrlHistory } from './useUrlHistory'
import UrlHistoryInput from './UrlHistoryInput'
import { hasTranscriptApi } from './env'
import { UMAP_METRICS, type UmapMetric } from './umapMetric'
import { TRACK_SWATCHES } from './palettes'

/**
 * v9: parallel live sessions. Two transcripts (e.g. two conference talks
 * happening at once) play simultaneously and are embedded, as they're spoken,
 * into one shared 3D space. One session is "active" at a time: its video,
 * transcript tabs and playhead are shown; the other keeps playing muted in
 * the background. Config (window, model, UMAP, speed, styling) is shared.
 */

const SESSION_IDS = ['a', 'b'] as const
type SessionId = typeof SESSION_IDS[number]
const sessionLabel = (k: number) => String.fromCharCode(65 + k)

/** UMAP needs more points than neighbours; below this the live view just waits. */
const LIVE_MIN_SEGMENTS = 5
/** Stable empty input so the 3D view renders (grid, auto-rotate) before the first layout. */
const NO_POINTS: [number, number, number][] = []
/** Above this the YouTube players can't keep up, so sessions run on a simulated clock. */
const MAX_VIDEO_SPEED = 2
/** A background video further than this from the shared clock gets re-seeked. */
const MAX_DRIFT_SECS = 1.5

const noTranscriptApiBuild = !hasTranscriptApi

function formatTime(secs: number) {
  const s = Math.max(0, Math.floor(secs))
  const h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60), r = s % 60
  return h > 0 ? `${h}:${String(m).padStart(2, '0')}:${String(r).padStart(2, '0')}` : `${m}:${String(r).padStart(2, '0')}`
}

/** Word index (into the transcript) where segment i's window ends. */
function segmentEndWord(i: number, nWords: number, windowSize: number, overlapPct: number) {
  const step = Math.max(1, Math.round(windowSize * (1 - overlapPct / 100)))
  return Math.min(nWords - 1, Math.min(windowSize - 1, nWords - 1) + i * step)
}

/** Fractional segment index at a word index (same mapping as v8's cursor handler). */
function highlightForWord(wordIndex: number, nWords: number, segCount: number, windowSize: number, overlapPct: number) {
  if (segCount === 0 || nWords === 0) return null
  const ends = Array.from({ length: segCount }, (_, i) => segmentEndWord(i, nWords, windowSize, overlapPct))
  if (wordIndex <= ends[0]) return 0
  if (wordIndex >= ends[segCount - 1]) return segCount - 1
  for (let i = 0; i < segCount - 1; i++) {
    if (wordIndex >= ends[i] && wordIndex < ends[i + 1]) return i + (wordIndex - ends[i]) / (ends[i + 1] - ends[i])
  }
  return segCount - 1
}

/** Plain text of a raw transcript (VTT/SRT or pasted text), as the transcript viewer derives it. */
function textFromRaw(raw: string | null) {
  if (!raw?.trim()) return ''
  return detectAndParseSubtitle(raw)?.text ?? raw.replace(/\s+/g, ' ').trim()
}

/**
 * One parallel session: its own video and transcript. Time is shared: every
 * session sits at the same event time (clamped to its own length).
 */
function useSession(id: SessionId, eventTime: number) {
  const prefix = `v9-${id}:`
  const [urlInput, setUrlInput] = useState(() => {
    const qs = new URLSearchParams(window.location.search).get(id)
    if (qs) return `https://www.youtube.com/watch?v=${qs}`
    return localStorage.getItem(prefix + 'yt-url') ?? ''
  })
  const videoId = extractVideoId(urlInput)
  const [text, setText] = useState(() =>
    // `||`, not `??`: an empty saved text shouldn't hide a transcript that's still in the raw textarea
    localStorage.getItem(prefix + 'transcript-text')
    || textFromRaw(localStorage.getItem(prefix + 'transcript-raw-text'))
    || localStorage.getItem(prefix + 'yt-transcript')
    || '')
  useEffect(() => { localStorage.setItem(prefix + 'transcript-text', text) }, [prefix, text])
  const [seekTarget, setSeekTarget] = useState<number | undefined>(undefined)
  const [videoDuration, setVideoDuration] = useState<number | null>(null)
  const transcript = useYoutubeTranscript(urlInput, {
    storagePrefix: prefix,
    onLoaded: ({ text }) => { setText(text); setVideoDuration(null) },
    onSubtitleLoaded: ({ text }) => { setText(text) },
  })
  const words = useMemo(() => text.trim().split(/\s+/).filter(Boolean), [text])
  const totalSecs = transcript.loadedDuration ? parseInt(transcript.loadedDuration) : null
  const durationMismatch = videoDuration !== null && totalSecs !== null
    && Math.abs(videoDuration - totalSecs) > Math.max(10, totalSecs * 0.05)
  /** Where the video ends (falls back to the transcript's length until the player reports it). */
  const videoEnd = videoDuration ?? totalSecs
  const time = totalSecs ? Math.min(eventTime, totalSecs) : eventTime
  const ended = totalSecs !== null && eventTime >= totalSecs
  const position = computeExternalPosition(time, transcript.wordTimestamps, totalSecs)

  const changeUrl = (val: string) => {
    setUrlInput(val)
    localStorage.setItem(prefix + 'yt-url', val)
    if (!extractVideoId(val)) {
      transcript.setLoadedVideoId(null)
      transcript.setWordTimestamps(null)
      localStorage.removeItem(prefix + 'yt-word-timestamps')
    }
  }

  return {
    id, prefix, urlInput, changeUrl, videoId, text, setText, words, transcript,
    time, ended, seekTarget, setSeekTarget, videoDuration, setVideoDuration, videoEnd,
    totalSecs, durationMismatch, position,
  }
}

export default function EmbeddingLayoutViewV9() {
  // One clock for the whole event, so sessions can never drift apart
  const [eventTime, setEventTime] = useState(0)
  const sessions = [useSession('a', eventTime), useSession('b', eventTime)]
  const [active, setActive] = useState(() => (localStorage.getItem('v9-active') === 'b' ? 1 : 0))
  const switchTo = useCallback((k: number) => { setActive(k); localStorage.setItem('v9-active', SESSION_IDS[k]) }, [])
  const cur = sessions[active]

  // ?a=<videoId>&b=<videoId>
  const videoIdA = sessions[0].videoId, videoIdB = sessions[1].videoId
  useEffect(() => {
    const url = new URL(window.location.href)
    ;([['a', videoIdA], ['b', videoIdB]] as const).forEach(([key, vid]) => {
      if (vid) url.searchParams.set(key, vid); else url.searchParams.delete(key)
    })
    history.replaceState(null, '', url.toString())
  }, [videoIdA, videoIdB])

  const { history: urlHistory } = useUrlHistory(cur.urlInput, cur.videoId)

  // ─── Shared playback ─────────────────────────────────────────────────────
  const [playing, setPlaying] = useState(false)
  const [playbackRate, setPlaybackRate] = useState(1)
  const fastMode = playbackRate > MAX_VIDEO_SPEED

  // Shared window settings, reported by whichever transcript viewer is showing
  const [windowSize, setWindowSize] = useState(() => Math.max(1, parseInt(localStorage.getItem('transcript-window') ?? '40') || 40))
  const [overlapPct, setOverlapPct] = useState(() => Math.min(99, Math.max(0, parseFloat(localStorage.getItem('transcript-overlap') ?? '80') || 0)))

  const segmentsA = useMemo(() => computeChunks(sessions[0].text, windowSize, overlapPct), [sessions[0].text, windowSize, overlapPct]) // eslint-disable-line react-hooks/exhaustive-deps
  const segmentsB = useMemo(() => computeChunks(sessions[1].text, windowSize, overlapPct), [sessions[1].text, windowSize, overlapPct]) // eslint-disable-line react-hooks/exhaustive-deps
  const segments = [segmentsA, segmentsB]

  const highlights = sessions.map((s, k) => {
    if (s.position === undefined || s.words.length === 0) return null
    const wordIndex = Math.min(s.words.length - 1, Math.floor(s.position * (s.words.length - 1)))
    return highlightForWord(wordIndex, s.words.length, segments[k].length, windowSize, overlapPct)
  })

  const sessionsRef = useRef(sessions)
  useEffect(() => { sessionsRef.current = sessions })
  const eventTimeRef = useRef(eventTime)
  useEffect(() => { eventTimeRef.current = eventTime }, [eventTime])
  /** End of the whole event: when the longest session finishes. */
  const eventEnd = Math.max(0, ...sessions.map(s => s.totalSecs ?? s.videoDuration ?? 0))

  /** Move the shared clock, and every video with it. */
  const seekAll = useCallback((t: number) => {
    const ss = sessionsRef.current
    const end = Math.max(0, ...ss.map(s => s.totalSecs ?? s.videoDuration ?? 0))
    const c = Math.max(0, end > 0 ? Math.min(end, t) : t)
    setEventTime(c)
    ss.forEach(s => { if (s.videoId) s.setSeekTarget(s.videoEnd ? Math.min(c, s.videoEnd) : c) })
  }, [])

  // Which video drives the clock: the active session's while it's still running,
  // otherwise the other's. With none (no videos, all ended, or faster than YouTube
  // allows) the clock is simulated.
  const videoRunning = (k: number) => {
    const s = sessions[k]
    return !!s.videoId && eventTime < (s.videoEnd ?? Infinity) - 0.5
  }
  const driver = fastMode ? -1 : ([active, 1 - active].find(videoRunning) ?? -1)

  useEffect(() => {
    if (!playing || driver !== -1) return
    let raf = 0
    let last = performance.now()
    const tick = (now: number) => {
      const dt = Math.min(0.25, (now - last) / 1000)
      last = now
      if (eventTimeRef.current >= eventEnd) { setPlaying(false); return }
      setEventTime(t => Math.min(eventEnd, t + dt * playbackRate))
      raf = requestAnimationFrame(tick)
    }
    raf = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(raf)
  }, [playing, driver, eventEnd, playbackRate])

  // Videos report their time ~4×/s. The driver sets the clock; the others are
  // nudged back if they drift (buffering, ads, slow start).
  const lastCorrectionRef = useRef<number[]>([0, 0])
  const handleVideoTime = (k: number, t: number) => {
    if (fastMode) return
    if (k === driver) { setEventTime(t); return }
    const s = sessions[k]
    const target = eventTime
    const now = performance.now()
    if (playing && Math.abs(t - target) > MAX_DRIFT_SECS && target < (s.videoEnd ?? Infinity) - 0.5
      && now - lastCorrectionRef.current[k] > 3000) {
      lastCorrectionRef.current[k] = now
      s.setSeekTarget(target)
    }
  }

  // Leaving fast mode: put the videos back at the shared time
  const fastPrevRef = useRef(fastMode)
  useEffect(() => {
    if (fastPrevRef.current && !fastMode) seekAll(eventTimeRef.current)
    fastPrevRef.current = fastMode
  }, [fastMode, seekAll])

  // Keyboard: space plays/pauses, arrows seek ±10s (both sessions)
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement
      if (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.tagName === 'SELECT' || target.isContentEditable) return
      if (e.key === ' ') { e.preventDefault(); setPlaying(p => !p) }
      else if (e.key === 'ArrowRight' || e.key === 'ArrowLeft') {
        e.preventDefault()
        seekAll(eventTimeRef.current + (e.key === 'ArrowRight' ? 10 : -10))
      }
    }
    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [seekAll])

  // Prevent pull-to-refresh and iOS bounce for the lifetime of this view
  useEffect(() => {
    const html = document.documentElement
    const prev = html.style.overflow
    html.style.overflow = 'hidden'
    return () => { html.style.overflow = prev }
  }, [])

  // ─── Shared config ───────────────────────────────────────────────────────
  const [selectedModel, setSelectedModel] = useState<EmbeddingModelId>(() => {
    const stored = localStorage.getItem('projector-model')
    return (EMBEDDING_MODELS.find(m => m.id === stored) ?? EMBEDDING_MODELS.find(m => m.default)!).id
  })
  const [umapMetric, setUmapMetric] = useState<UmapMetric>(() => localStorage.getItem('umap-metric') === 'euclidean' ? 'euclidean' : 'cosine')
  const [liveEvery, setLiveEvery] = useState(() => Math.max(1, parseInt(localStorage.getItem('live-embed-every') ?? '1') || 1))
  const [lineWidth, setLineWidth] = useState(() => parseFloat(localStorage.getItem('live-line-width') ?? '') || DEFAULT_LINE_WIDTH)
  const [nodeSize, setNodeSize] = useState(() => parseFloat(localStorage.getItem('live-node-size') ?? '') || DEFAULT_NODE_SIZE)
  const [autoRotate, setAutoRotate] = useState(() => localStorage.getItem('live-auto-rotate') === 'true')
  const [showGrid, setShowGrid] = useState(() => localStorage.getItem('live-show-grid') !== 'false')
  const [autoRotateSpeed, setAutoRotateSpeed] = useState(() => parseFloat(localStorage.getItem('live-auto-rotate-speed') ?? '') || 1)
  const [rendererType, setRendererType] = useState<LiveRenderer>(() => {
    const stored = localStorage.getItem('scatter-renderer')
    return stored === 'original' || stored === 'cividis-tube' ? stored : 'glow'
  })
  const chooseRenderer = (v: LiveRenderer) => { setRendererType(v); localStorage.setItem('scatter-renderer', v) }
  const chooseAutoRotate = (on: boolean) => { setAutoRotate(on); localStorage.setItem('live-auto-rotate', String(on)) }
  const [glowStrength, setGlowStrength] = useState(() => parseFloat(localStorage.getItem('glow-strength') ?? '1'))

  // ─── Live embedding into one shared space ────────────────────────────────
  // Segments from both sessions are appended in the order the playheads pass
  // them; the worker embeds that growing list incrementally, so both paths are
  // laid out by the same UMAP.
  type Entry = { track: number; seg: number; text: string }
  const { points: livePoints, status: liveStatus, update: liveUpdate, reset: liveReset } = useLiveEmbedding()
  const entriesRef = useRef<Entry[]>([])
  const [entries, setEntries] = useState<Entry[]>([])
  const completedRef = useRef<number[]>([0, 0])  // per session: segments passed (only grows)
  const laidOutRef = useRef(0)                    // entries included in the last layout request
  const [liveEpoch, setLiveEpoch] = useState(0)

  const resetLive = useCallback(() => {
    entriesRef.current = []
    setEntries([])
    completedRef.current = [0, 0]
    laidOutRef.current = 0
    liveReset()
    setLiveEpoch(e => e + 1)
  }, [liveReset])

  const segKey = (segs: string[]) => segs.length > 0 ? `${segs.length}:${segs[0]}` : ''
  const segmentsKeyA = segKey(segmentsA), segmentsKeyB = segKey(segmentsB)
  useEffect(() => { resetLive() }, [segmentsKeyA, segmentsKeyB, selectedModel, umapMetric, resetLive])

  /** Event time (secs) when segment `seg` of session `k` finished being spoken. */
  const segmentSpokenAt = (k: number, seg: number) => {
    const s = sessionsRef.current[k]
    const n = s.words.length
    if (n === 0) return 0
    const w = segmentEndWord(seg, n, windowSize, overlapPct)
    const ts = s.transcript.wordTimestamps
    if (ts && ts.length > 0) return ts[Math.min(w, ts.length - 1)]
    return n > 1 && s.totalSecs ? (w / (n - 1)) * s.totalSecs : w
  }

  const [hlA, hlB] = highlights
  useEffect(() => {
    // After a jump ahead, both sessions can have a backlog. Merge them in the order
    // the segments were spoken (as if the jump hadn't happened), so the worker's
    // batches grow both paths together instead of finishing one session first.
    const pending: (Entry & { at: number })[] = []
    let reachedEnd = false
    ;[hlA, hlB].forEach((hl, k) => {
      const segs = k === 0 ? segmentsA : segmentsB
      if (hl === null || segs.length === 0) return
      const passed = Math.min(segs.length, Math.floor(hl) + 1)
      for (let i = completedRef.current[k]; i < passed; i++) {
        pending.push({ track: k, seg: i, text: segs[i], at: segmentSpokenAt(k, i) })
        if (i === segs.length - 1) reachedEnd = true
      }
      completedRef.current[k] = Math.max(completedRef.current[k], passed)
    })
    if (pending.length === 0) return
    pending.sort((x, y) => x.at - y.at || x.track - y.track)
    for (const { at: _at, ...e } of pending) entriesRef.current.push(e) // eslint-disable-line @typescript-eslint/no-unused-vars
    setEntries([...entriesRef.current])
    const total = entriesRef.current.length
    if (total < LIVE_MIN_SEGMENTS) return
    if (laidOutRef.current === 0 || total - laidOutRef.current >= liveEvery || reachedEnd) {
      laidOutRef.current = total
      liveUpdate(entriesRef.current.map(e => e.text), selectedModel, umapMetric)
    }
  // segmentsA/B are covered by liveEpoch (a change resets and bumps it)
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [hlA, hlB, liveEpoch, liveEvery, selectedModel, umapMetric, liveUpdate])

  const pointTracks = useMemo(() => entries.map(e => e.track), [entries])
  const pointLabels = useMemo(() => entries.map(e => e.text), [entries])
  const laidOutPerTrack = [0, 1].map(k => livePoints ? pointTracks.slice(0, livePoints.length).filter(t => t === k).length : 0)

  // ─── Interaction ─────────────────────────────────────────────────────────
  const [scrollToWord, setScrollToWord] = useState<{ wordIndex: number; nonce: number } | undefined>(undefined)
  const cameraStateRef = useRef<CameraState | null>(null)

  const seekSessionToSegment = useCallback((k: number, seg: number) => {
    const s = sessionsRef.current[k]
    const n = s.words.length
    if (n === 0) return
    const wordIndex = segmentEndWord(seg, n, windowSize, overlapPct)
    setScrollToWord(prev => ({ wordIndex, nonce: (prev?.nonce ?? 0) + 1 }))
    if (!s.totalSecs) return
    const ts = s.transcript.wordTimestamps
    seekAll(ts && ts.length > 0 ? ts[Math.min(wordIndex, ts.length - 1)] : (n > 1 ? (wordIndex / (n - 1)) * s.totalSecs : 0))
  }, [windowSize, overlapPct, seekAll])

  // Clicking a point jumps to that moment, switching to its session if needed
  const handlePointClick = useCallback((idx: number) => {
    const e = entriesRef.current[idx]
    if (!e) return
    switchTo(e.track)
    seekSessionToSegment(e.track, e.seg)
  }, [switchTo, seekSessionToSegment])

  // Bound to the session index rather than read from a ref: on a session switch
  // the newly mounted viewer reports its text from its own effects, which run
  // before this component's effects, so a ref would still name the previous
  // session and its text would be overwritten.
  const sessionSetText = sessions[active].setText
  const handleWindowChange = useCallback((params: { windowSize: number; overlapPct: number; text: string }) => {
    setWindowSize(params.windowSize)
    setOverlapPct(params.overlapPct)
    sessionSetText(params.text)
  }, [sessionSetText])

  const handleScrub = useCallback((pos: number) => {
    const s = sessionsRef.current[active]
    if (s.totalSecs) seekAll(pos * s.totalSecs)
  }, [active, seekAll])

  const [transcriptTab, setTranscriptTab] = useState(() => cur.text.trim() ? 'windowed' : 'raw')

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
  useEffect(() => {
    if (isDesktop && transcriptTab === '3d') setTranscriptTab('windowed')
  }, [isDesktop]) // eslint-disable-line react-hooks/exhaustive-deps

  const activeSegments = segments[active]
  const segmentsContent = useMemo(() => activeSegments.length > 0 ? (
    <ul className="list-none p-0 m-0 overflow-y-auto overscroll-y-contain flex-1">
      {activeSegments.map((seg, i) => (
        <li key={i} className="flex gap-2 py-2 px-3.5 border-b border-border text-[13px] items-start">
          <span className="text-text opacity-50 min-w-[28px] flex-shrink-0 text-right tabular-nums pt-[1px]">{i + 1}</span>
          <span className="text-text-h leading-[1.45]">{seg}</span>
        </li>
      ))}
    </ul>
  ) : (
    <div className="flex-1 flex items-center justify-center text-text opacity-40 text-sm p-8 text-center">
      Load a transcript for session {sessionLabel(active)} to see its segments.
    </div>
  ), [activeSegments, active])

  // ─── Blocks ──────────────────────────────────────────────────────────────
  const sessionToggle = (
    <div className="flex flex-shrink-0 rounded-md border border-border overflow-hidden" role="tablist" aria-label="Session">
      {sessions.map((s, k) => (
        <button
          key={s.id}
          role="tab"
          aria-selected={k === active}
          onClick={() => switchTo(k)}
          title={`Show session ${sessionLabel(k)}`}
          className={`flex items-center gap-1.5 py-1.5 px-2.5 text-[13px] cursor-pointer border-0 whitespace-nowrap tabular-nums ${k === active ? 'bg-accent text-white' : 'bg-code-bg text-text-h hover:bg-border'} ${k > 0 ? 'border-l border-border' : ''}`}
        >
          <span className="w-2.5 h-2.5 rounded-full flex-shrink-0" style={{ background: TRACK_SWATCHES[k] }} />
          <span className="font-semibold">{sessionLabel(k)}</span>
          <span className="opacity-75 text-[12px]">{!s.totalSecs ? '—' : s.ended ? 'ended' : formatTime(s.time)}</span>
        </button>
      ))}
    </div>
  )

  // Both players stay mounted so the background session keeps playing (muted); only the active one is visible
  const videoBlock = (
    <div className="relative flex-shrink-0">
      {sessions.map((s, k) => s.videoId && (
        <div
          key={s.id}
          className={k === active ? 'relative' : 'absolute inset-0 pointer-events-none'}
          style={{ visibility: k === active && !fastMode ? 'visible' : 'hidden' }}
          aria-hidden={k !== active}
        >
          <YoutubePlayerEmbed
            videoId={s.videoId}
            onTimeUpdate={t => handleVideoTime(k, t)}
            seekTo={fastMode ? undefined : s.seekTarget}
            playing={!fastMode && playing}
            onPlayStateChange={k === active && !fastMode ? setPlaying : undefined}
            playbackRate={Math.min(playbackRate, MAX_VIDEO_SPEED)}
            onVideoDuration={s.setVideoDuration}
            noBottomMargin={isDesktop}
            muted={k !== active}
          />
        </div>
      ))}
      {(!cur.videoId || fastMode) && (
        <div className={`${cur.videoId ? 'absolute inset-0' : ''} w-full max-w-[640px] mx-auto`}>
          <div className="yt-player-aspect relative w-full aspect-video bg-code-bg rounded flex items-center justify-center">
            <span className="text-text opacity-40 text-[13px] text-center px-4">
              {fastMode ? `Videos paused — playing faster than ${MAX_VIDEO_SPEED}×` : `Paste a YouTube URL above to load session ${sessionLabel(active)}`}
            </span>
          </div>
        </div>
      )}
    </div>
  )

  const configContent = (
    <div className="flex-1 overflow-y-auto p-4 flex flex-col gap-4">
      <p className="text-[12px] text-text opacity-60 m-0">Settings here (and window size, overlap and speed) apply to both sessions.</p>
      <div className="flex flex-col gap-2">
        <div className="flex items-center justify-between">
          <label htmlFor="v9-umap-metric" className="text-[13px] text-text-h font-medium">UMAP distance</label>
          <select
            id="v9-umap-metric"
            value={umapMetric}
            onChange={e => { const v = e.target.value as UmapMetric; setUmapMetric(v); localStorage.setItem('umap-metric', v) }}
            className="py-1 px-2 border border-border rounded-md bg-code-bg text-text-h text-[13px]"
          >
            {UMAP_METRICS.map(m => <option key={m.id} value={m.id}>{m.label}</option>)}
          </select>
        </div>
        <p className="text-[12px] text-text opacity-40 m-0">Changing it restarts the live layout.</p>
      </div>
      <div className="flex flex-col gap-2">
        <div className="flex items-center justify-between">
          <label htmlFor="v9-live-every" className="text-[13px] text-text-h font-medium">Re-layout every N segments</label>
          <input
            id="v9-live-every"
            type="number"
            min={1}
            value={liveEvery}
            onChange={e => { const v = Math.max(1, parseInt(e.target.value) || 1); setLiveEvery(v); localStorage.setItem('live-embed-every', String(v)) }}
            className="w-16 py-1 px-2 border border-border rounded-md bg-code-bg text-text-h text-[13px] tabular-nums"
          />
        </div>
        <p className="text-[12px] text-text opacity-40 m-0">Counts new segments from either session.</p>
      </div>
      <div className="flex flex-col gap-2">
        <div className="flex items-center justify-between">
          <label htmlFor="v9-renderer" className="text-[13px] text-text-h font-medium">Renderer</label>
          <select id="v9-renderer" value={rendererType}
            className="py-1 px-2 border border-border rounded-md bg-code-bg text-text-h text-[13px] cursor-pointer"
            onChange={e => chooseRenderer(e.target.value as LiveRenderer)}>
            <option value="original">Lines</option>
            <option value="cividis-tube">Tubes</option>
            <option value="glow">Glow</option>
          </select>
        </div>
        <div className={`flex flex-col gap-2 ${rendererType === 'glow' ? '' : 'opacity-40 pointer-events-none'}`}>
          <div className="flex items-center justify-between">
            <label htmlFor="v9-glow-strength" className="text-[13px] text-text-h font-medium">Glow strength</label>
            <span className="text-[13px] text-text opacity-60 tabular-nums">{glowStrength.toFixed(2)}</span>
          </div>
          <input id="v9-glow-strength" type="range" min={0} max={2} step={0.05} value={glowStrength}
            onChange={e => { const v = parseFloat(e.target.value); setGlowStrength(v); localStorage.setItem('glow-strength', String(v)) }}
            className="w-full accent-accent" />
        </div>
        <div className="flex items-center justify-between">
          <label htmlFor="v9-line-width" className="text-[13px] text-text-h font-medium">Line width</label>
          <span className="text-[13px] text-text opacity-60 tabular-nums">{lineWidth.toFixed(1)} px</span>
        </div>
        <input id="v9-line-width" type="range" min={0.5} max={10} step={0.5} value={lineWidth}
          onChange={e => { const v = parseFloat(e.target.value); setLineWidth(v); localStorage.setItem('live-line-width', String(v)) }}
          className="w-full accent-accent" />
        <div className="flex items-center justify-between">
          <label htmlFor="v9-node-size" className="text-[13px] text-text-h font-medium">Node size</label>
          <span className="text-[13px] text-text opacity-60 tabular-nums">{(nodeSize / DEFAULT_NODE_SIZE).toFixed(2)}×</span>
        </div>
        <input id="v9-node-size" type="range" min={0.01} max={0.16} step={0.005} value={nodeSize}
          onChange={e => { const v = parseFloat(e.target.value); setNodeSize(v); localStorage.setItem('live-node-size', String(v)) }}
          className="w-full accent-accent" />
        <label className="flex items-center gap-2 text-[13px] text-text-h font-medium cursor-pointer mt-2">
          <input type="checkbox" checked={autoRotate}
            onChange={e => chooseAutoRotate(e.target.checked)} />
          Auto-rotate
        </label>
        <div className={`flex flex-col gap-2 ${autoRotate ? '' : 'opacity-40 pointer-events-none'}`}>
          <div className="flex items-center justify-between">
            <label htmlFor="v9-rotate-speed" className="text-[13px] text-text-h font-medium">Rotation speed</label>
            <span className="text-[13px] text-text opacity-60 tabular-nums">{Math.round(60 / autoRotateSpeed)}s / turn</span>
          </div>
          <input id="v9-rotate-speed" type="range" min={0.1} max={5} step={0.1} value={autoRotateSpeed}
            onChange={e => { const v = parseFloat(e.target.value); setAutoRotateSpeed(v); localStorage.setItem('live-auto-rotate-speed', String(v)) }}
            className="w-full accent-accent" />
        </div>
        <label className="flex items-center gap-2 text-[13px] text-text-h font-medium cursor-pointer mt-2">
          <input type="checkbox" checked={showGrid}
            onChange={e => { setShowGrid(e.target.checked); localStorage.setItem('live-show-grid', String(e.target.checked)) }} />
          Ground grid
        </label>
      </div>
    </div>
  )

  const anyText = segmentsA.length > 0 || segmentsB.length > 0
  // The scene (grid, auto-rotate) shows from the start; status text sits over it until the first points arrive
  const threeDContent = (
    <div className="flex-1 min-h-0 flex flex-col overflow-hidden relative">
      <RendererToggle value={rendererType} onChange={chooseRenderer} autoRotate={autoRotate} onAutoRotateChange={chooseAutoRotate} />
      <ScatterPlot3DMulti
        key={rendererType}
        renderer={rendererType}
        glowStrength={glowStrength}
        points={livePoints ?? NO_POINTS}
        pointTracks={pointTracks}
        labels={pointLabels}
        trackCount={2}
        highlights={highlights}
        activeTrack={active}
        onPointClick={handlePointClick}
        initialCameraState={cameraStateRef.current ?? undefined}
        onCameraChange={s => { cameraStateRef.current = s }}
        lineWidth={lineWidth}
        nodeSize={nodeSize}
        autoRotate={autoRotate}
        autoRotateSpeed={autoRotateSpeed}
        showGrid={showGrid}
      />
      {livePoints !== null ? (
      <div className="absolute bottom-2 right-2 text-[11px] text-right pointer-events-none leading-tight select-none rounded px-1.5 py-1" style={{ background: 'rgba(0,0,0,0.45)', color: 'rgba(255,255,255,0.75)' }}>
        <div>{EMBEDDING_MODELS.find(m => m.id === selectedModel)?.label ?? selectedModel.split('/').pop()}</div>
        {[0, 1].map(k => (
          <div key={k} className="flex items-center justify-end gap-1">
            <span className="w-2 h-2 rounded-full inline-block" style={{ background: TRACK_SWATCHES[k] }} />
            {sessionLabel(k)}: {laidOutPerTrack[k]} / {segments[k].length}
          </div>
        ))}
        <div>
          {liveStatus.status === 'updating' ? 'updating…' : ''}
          {entries.length - livePoints.length > 0 ? ` ${entries.length - livePoints.length} waiting` : ''}
        </div>
      </div>
      ) : (
    <div className="absolute inset-0 flex items-center justify-center p-8 text-center text-sm pointer-events-none select-none" style={{ color: 'rgba(255,255,255,0.6)' }}>
      {liveStatus.status === 'model-loading'
        ? `Loading model… ${liveStatus.progress}%`
        : liveStatus.status === 'updating'
        ? 'Embedding…'
        : !anyText
        ? 'Load a transcript into session A and/or B, then press play.'
        : entries.length < LIVE_MIN_SEGMENTS
        ? `Press play — points appear after ${LIVE_MIN_SEGMENTS} segments across both sessions (${entries.length} so far).`
        : 'Embedding…'}
    </div>
      )}
    </div>
  )

  const noTranscriptApi = noTranscriptApiBuild || cur.transcript.serverFailed
  const transcriptToolUrl = cur.videoId
    ? `https://www.youtube-transcript.io/videos?id=${cur.videoId}`
    : 'https://www.youtube-transcript.io'
  const loadStatus = cur.transcript.status

  // Keyed by session: switching remounts the viewer with that session's text; position, play state and speed come from here
  const transcriptKey = `${cur.id}-${cur.transcript.loadedVideoId ?? 'empty'}-${cur.transcript.loadCount}`
  const transcriptViewerProps = {
    storagePrefix: cur.prefix,
    initialText: cur.text,
    initialDuration: cur.transcript.loadedDuration ?? undefined,
    onWindowChange: handleWindowChange,
    scrollToWord,
    externalPosition: cur.position,
    externalPlaying: playing,
    externalSpeed: playbackRate,
    onScrub: handleScrub,
    onPlayingChange: setPlaying,
    onSpeedChange: setPlaybackRate,
    hideSegmentsMode: true,
    onSubtitleLoad: cur.transcript.handleSubtitleLoad,
    hideFileLoad: !noTranscriptApi,
    tab: transcriptTab,
    onTabChange: setTranscriptTab,
    warning: cur.durationMismatch ? `⚠ Transcript duration (${cur.totalSecs}s) doesn't match video (${Math.round(cur.videoDuration!)}s) — transcript may be out of date.` : undefined,
    prependTextareaButtons: (
      <button
        className="flex-shrink-0 py-1.5 px-3 rounded-md border-0 bg-accent text-white text-[13px] font-medium cursor-pointer whitespace-nowrap transition-opacity duration-150 hover:opacity-85 disabled:opacity-50 disabled:cursor-not-allowed"
        onClick={noTranscriptApi ? () => window.open(transcriptToolUrl, '_blank') : cur.transcript.handleLoad}
        disabled={noTranscriptApi ? !cur.videoId : loadStatus === 'loading'}
      >
        {!noTranscriptApi && loadStatus === 'loading' ? 'Loading…' : `Fetch${noTranscriptApi ? ' ↗' : ''}`}
      </button>
    ),
  }

  return (
    <div className="flex flex-col h-[100dvh] overflow-hidden overscroll-none">
      <dialog
        ref={infoDialogRef}
        onClick={e => { if (e.target === infoDialogRef.current) setInfoOpen(false) }}
        className="m-auto backdrop:bg-black/40 rounded-xl border border-border bg-bg text-text p-6 w-[min(380px,90vw)] shadow-lg"
      >
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-base font-semibold m-0">Parallel sessions</h2>
          <button onClick={() => setInfoOpen(false)} className="text-text opacity-50 hover:opacity-100 bg-transparent border-0 text-xl cursor-pointer leading-none">×</button>
        </div>
        <p className="text-sm m-0 mb-3">
          Simulates two conference sessions running at the same time. Load a video into A and B; both play together
          (the hidden one muted) and are embedded into one shared space as they're spoken. The A/B toggle switches which
          session's video, transcript and playhead you're looking at.
        </p>
        <p className="text-sm m-0 mb-3">
          Need videos? Try the{' '}
          <a
            href="https://www.youtube.com/playlist?list=PLdH_E8WPD_iv2OPkVyJESUnfuWD7qPZSE"
            target="_blank"
            rel="noopener noreferrer"
            className="text-accent no-underline hover:underline"
          >
            Living Room Conversations playlist ↗
          </a>
          : small-group conversations across differences, good for comparing two discussions side by side.
        </p>
        <a href="#index" onClick={() => setInfoOpen(false)} className="text-sm text-accent no-underline hover:underline">
          Version Index →
        </a>
      </dialog>

      {/* URL bar: session toggle + the active session's URL */}
      <div className="flex-shrink-0 py-2.5 px-4 border-b border-border flex flex-col gap-1.5">
        <div className="flex gap-2 items-center">
          <button
            onClick={() => setInfoOpen(true)}
            className="flex-shrink-0 w-6 h-6 rounded-full border border-current flex items-center justify-center text-xs font-bold opacity-40 hover:opacity-80 bg-transparent cursor-pointer text-inherit"
            aria-label="About"
          >i</button>
          {sessionToggle}
          <UrlHistoryInput
            key={cur.id}
            value={cur.urlInput}
            onChange={cur.changeUrl}
            onKeyDown={e => { if (e.key === 'Enter' && !noTranscriptApi) cur.transcript.handleLoad() }}
            placeholder={`Session ${sessionLabel(active)}: https://www.youtube.com/watch?v=...`}
            history={urlHistory}
          />
        </div>
        {loadStatus === 'error' && <p className="text-[13px] text-[#e53e3e] m-0">{cur.transcript.errorMessage}</p>}
      </div>

      {isDesktop ? (
        <>
          <div className="flex flex-shrink-0 overflow-hidden">
            <div className="w-1/2 flex-shrink-0 overflow-hidden">{videoBlock}</div>
            <div className="w-1/2 flex-shrink-0 overflow-hidden border-l border-border">
              <div className="relative w-full aspect-video">
                <div className="absolute inset-0 flex flex-col">{threeDContent}</div>
              </div>
            </div>
          </div>
          <div className="flex-1 min-h-0 border-t border-border flex flex-col overflow-hidden">
            <TranscriptViewer
              key={transcriptKey}
              {...transcriptViewerProps}
              tab={transcriptTab === '3d' ? 'windowed' : transcriptTab}
              extraTabs={[{ id: 'segments', label: 'Segments' }, { id: 'config', label: 'Config' }]}
              extraTabContent={transcriptTab === 'config' ? configContent : segmentsContent}
            />
          </div>
        </>
      ) : (
        <div className="flex flex-1 min-h-0 overflow-hidden">
          <div className="flex-1 min-w-0 flex flex-col sm:flex-row overflow-hidden">
            <div className="flex-shrink-0 sm:w-1/2 sm:overflow-hidden">{videoBlock}</div>
            <div className="flex-1 min-h-0 min-w-0 flex flex-col overflow-hidden">
              <TranscriptViewer
                key={transcriptKey}
                {...transcriptViewerProps}
                extraTabs={[
                  { id: 'segments', label: 'Segments' },
                  { id: '3d', label: '3D' },
                  { id: 'config', label: 'Config' },
                ]}
                extraTabContent={transcriptTab === 'segments' ? segmentsContent : transcriptTab === 'config' ? configContent : threeDContent}
              />
            </div>
          </div>
        </div>
      )}

      {/* Bottom: live status, model, reset */}
      <div className="flex-shrink-0 border-t border-border px-4 py-2.5 flex flex-col gap-2">
        <div className="flex gap-2 items-center flex-wrap">
          <span className="text-[13px] text-text flex items-center gap-2 whitespace-nowrap">
            {(liveStatus.status === 'updating' || liveStatus.status === 'model-loading') && <div className="spinner" />}
            {liveStatus.status === 'model-loading'
              ? `Loading model… ${liveStatus.progress}%`
              : `Live: ${livePoints?.length ?? 0} embedded (A ${laidOutPerTrack[0]} · B ${laidOutPerTrack[1]})`}
          </span>
          <select
            className="flex-1 py-1.5 px-2 border border-border rounded-md bg-code-bg text-text-h text-[13px] cursor-pointer focus:outline-2 focus:outline-accent focus:outline-offset-[1px]"
            value={selectedModel}
            onChange={e => { const v = e.target.value as EmbeddingModelId; setSelectedModel(v); localStorage.setItem('projector-model', v) }}
          >
            {EMBEDDING_MODELS.map(m => <option key={m.id} value={m.id}>{m.label}</option>)}
          </select>
          <button
            className="py-1.5 px-3 rounded-md border border-border bg-code-bg text-text-h text-[13px] cursor-pointer whitespace-nowrap hover:bg-border"
            onClick={resetLive}
            title="Clear embedded points; they rebuild as the playheads move forward"
          >
            Reset live
          </button>
        </div>
        {liveStatus.status === 'error' && <p className="text-[#e53e3e] text-[13px] m-0 w-full">{liveStatus.message}</p>}
      </div>
    </div>
  )
}
