import { useState, useRef, useCallback, useEffect } from 'react'
import TranscriptViewer from './TranscriptViewer'
import TranscriptionWorker from './transcriptionWorker?worker'
import type { TranscriptionChunk, TranscriptionEvent } from './transcriptionWorker.types'

const MODELS = [
  { id: 'Xenova/whisper-tiny.en', label: 'tiny.en (~150MB)' },
  { id: 'Xenova/whisper-base.en', label: 'base.en (~290MB)' },
  { id: 'Xenova/whisper-small.en', label: 'small.en (~970MB)' },
]

type Phase = 'idle' | 'loading-audio' | 'model-loading' | 'transcribing' | 'ready' | 'error'

function formatVttTime(secs: number): string {
  const h = Math.floor(secs / 3600)
  const m = Math.floor((secs % 3600) / 60)
  const s = secs % 60
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:${s.toFixed(3).padStart(6, '0')}`
}

function chunksToVtt(chunks: TranscriptionChunk[], totalDuration: number): string {
  const lines = ['WEBVTT', '']
  chunks.forEach((chunk, i) => {
    const start = chunk.timestamp[0]
    const end = chunk.timestamp[1] ?? chunks[i + 1]?.timestamp[0] ?? totalDuration
    lines.push(`${formatVttTime(start)} --> ${formatVttTime(end)}`)
    lines.push(chunk.text.trim())
    lines.push('')
  })
  return lines.join('\n')
}

/** For each word in the full transcript, compute an approximate start time
 *  by linearly interpolating within each chunk. */
function buildWordTimestamps(transcript: string, chunks: TranscriptionChunk[]): number[] {
  const words = transcript.trim().split(/\s+/)
  const timestamps = new Array<number>(words.length).fill(0)
  let wordIdx = 0
  for (let ci = 0; ci < chunks.length; ci++) {
    const chunk = chunks[ci]
    const chunkWords = chunk.text.trim().split(/\s+/).filter(Boolean)
    if (chunkWords.length === 0) continue
    const start = chunk.timestamp[0]
    const end = chunk.timestamp[1] ?? (ci + 1 < chunks.length ? chunks[ci + 1].timestamp[0] : start + 5)
    for (let wi = 0; wi < chunkWords.length && wordIdx < words.length; wi++) {
      timestamps[wordIdx++] = start + (wi / Math.max(1, chunkWords.length - 1)) * (end - start)
    }
  }
  return timestamps
}

export default function AudioFileTranscriptViewer() {
  const [phase, setPhase] = useState<Phase>('idle')
  const [modelId, setModelId] = useState(MODELS[0].id)
  const [modelProgress, setModelProgress] = useState(0)
  const [errorMsg, setErrorMsg] = useState('')
  const [transcript, setTranscript] = useState('')
  const [vttText, setVttText] = useState('')
  const [audioDuration, setAudioDuration] = useState('')
  const [audioUrl, setAudioUrl] = useState<string | null>(null)
  const [externalPosition, setExternalPosition] = useState<number | undefined>(undefined)
  const [externalPlaying, setExternalPlaying] = useState<boolean | undefined>(undefined)

  const fileInputRef = useRef<HTMLInputElement>(null)
  const audioRef = useRef<HTMLAudioElement>(null)
  const workerRef = useRef<Worker | null>(null)
  const rafRef = useRef<number | null>(null)
  const prevUrlRef = useRef<string | null>(null)
  const wordTimestampsRef = useRef<number[]>([])

  useEffect(() => {
    return () => {
      if (prevUrlRef.current) URL.revokeObjectURL(prevUrlRef.current)
      if (rafRef.current !== null) cancelAnimationFrame(rafRef.current)
    }
  }, [])

  const handleFileChange = useCallback(async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (!file) return
    e.target.value = ''

    if (prevUrlRef.current) {
      URL.revokeObjectURL(prevUrlRef.current)
      prevUrlRef.current = null
    }
    if (rafRef.current !== null) {
      cancelAnimationFrame(rafRef.current)
      rafRef.current = null
    }

    setPhase('loading-audio')
    setTranscript('')
    setVttText('')
    wordTimestampsRef.current = []
    setExternalPosition(undefined)
    setExternalPlaying(undefined)

    try {
      const arrayBuffer = await file.arrayBuffer()
      const audioCtx = new AudioContext()
      const audioBuffer = await audioCtx.decodeAudioData(arrayBuffer)
      await audioCtx.close()

      const targetSampleRate = 16000
      const length = Math.ceil(audioBuffer.duration * targetSampleRate)
      const offlineCtx = new OfflineAudioContext(1, length, targetSampleRate)
      const src = offlineCtx.createBufferSource()
      src.buffer = audioBuffer
      src.connect(offlineCtx.destination)
      src.start()
      const resampled = await offlineCtx.startRendering()
      const float32 = resampled.getChannelData(0)

      const url = URL.createObjectURL(file)
      prevUrlRef.current = url
      setAudioUrl(url)
      const durationSecs = audioBuffer.duration
      setAudioDuration(String(Math.round(durationSecs)))

      if (workerRef.current) workerRef.current.terminate()
      const worker = new TranscriptionWorker()
      workerRef.current = worker

      worker.onmessage = (ev: MessageEvent<TranscriptionEvent>) => {
        const msg = ev.data
        if (msg.type === 'progress:model-loading') {
          setPhase('model-loading')
          setModelProgress(msg.progress)
        } else if (msg.type === 'progress:transcribing') {
          setPhase('transcribing')
        } else if (msg.type === 'done') {
          localStorage.removeItem('transcript-raw-text')
          localStorage.removeItem('transcript-text')
          const text = msg.text.trim()
          const chunks = msg.chunks
          if (chunks.length > 0) {
            wordTimestampsRef.current = buildWordTimestamps(text, chunks)
            setVttText(chunksToVtt(chunks, durationSecs))
          } else {
            // No chunk timestamps available — synthesize evenly-spaced word timestamps
            const words = text.split(/\s+/)
            wordTimestampsRef.current = words.map((_, i) => (i / Math.max(1, words.length - 1)) * durationSecs)
            setVttText('')
          }
          setTranscript(text)
          setPhase('ready')
        } else if (msg.type === 'error') {
          setErrorMsg(msg.message)
          setPhase('error')
        }
      }

      worker.postMessage({ type: 'transcribe', audioData: float32, modelId }, [float32.buffer])
      setPhase('model-loading')
    } catch (err) {
      setErrorMsg(String(err))
      setPhase('error')
    }
  }, [modelId])

  // Drive externalPosition via rAF using word-level timestamps when available
  const syncPosition = useCallback(() => {
    const audio = audioRef.current
    if (!audio || audio.paused || !isFinite(audio.duration) || audio.duration === 0) return

    const wts = wordTimestampsRef.current
    let pos: number
    if (wts.length > 1) {
      const t = audio.currentTime
      let lo = 0
      for (let i = 1; i < wts.length; i++) {
        if (wts[i] <= t) lo = i
        else break
      }
      pos = lo / (wts.length - 1)
    } else {
      pos = audio.currentTime / audio.duration
    }

    setExternalPosition(pos)
    rafRef.current = requestAnimationFrame(syncPosition)
  }, [])

  const handleAudioPlay = useCallback(() => {
    setExternalPlaying(true)
    rafRef.current = requestAnimationFrame(syncPosition)
  }, [syncPosition])

  const handleAudioPause = useCallback(() => {
    setExternalPlaying(false)
    if (rafRef.current !== null) {
      cancelAnimationFrame(rafRef.current)
      rafRef.current = null
    }
    const audio = audioRef.current
    if (audio && isFinite(audio.duration) && audio.duration > 0) {
      const wts = wordTimestampsRef.current
      if (wts.length > 1) {
        const t = audio.currentTime
        let lo = 0
        for (let i = 1; i < wts.length; i++) {
          if (wts[i] <= t) lo = i
          else break
        }
        setExternalPosition(lo / (wts.length - 1))
      } else {
        setExternalPosition(audio.currentTime / audio.duration)
      }
    }
  }, [])

  const handleAudioEnded = useCallback(() => {
    setExternalPlaying(false)
    if (rafRef.current !== null) {
      cancelAnimationFrame(rafRef.current)
      rafRef.current = null
    }
    setExternalPosition(1)
  }, [])

  const handleScrub = useCallback((pos: number) => {
    const audio = audioRef.current
    if (audio && isFinite(audio.duration)) {
      // Map word position back to a timestamp for seeking
      const wts = wordTimestampsRef.current
      if (wts.length > 1) {
        const wordIdx = Math.round(pos * (wts.length - 1))
        audio.currentTime = wts[Math.min(wordIdx, wts.length - 1)]
      } else {
        audio.currentTime = pos * audio.duration
      }
    }
    setExternalPosition(pos)
  }, [])

  const handlePlayingChange = useCallback((playing: boolean) => {
    const audio = audioRef.current
    if (!audio) return
    if (playing) audio.play().catch(() => {})
    else audio.pause()
  }, [])

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100dvh' }}>
      <div style={{ padding: '0.5rem 1rem', display: 'flex', alignItems: 'center', gap: '1rem', background: '#111', flexShrink: 0, flexWrap: 'wrap' }}>
        <select
          value={modelId}
          onChange={e => setModelId(e.target.value)}
          disabled={phase !== 'idle' && phase !== 'ready' && phase !== 'error'}
          style={{ background: '#222', color: '#ccc', border: '1px solid #444', borderRadius: 4, padding: '0.3rem 0.5rem', fontSize: '0.85rem' }}
        >
          {MODELS.map(m => <option key={m.id} value={m.id}>{m.label}</option>)}
        </select>
        <button
          onClick={() => fileInputRef.current?.click()}
          style={{ padding: '0.35rem 0.9rem', background: '#2980b9', color: '#fff', border: 'none', borderRadius: 4, cursor: 'pointer', fontWeight: 'bold', fontSize: '0.9rem' }}
        >
          Load audio file
        </button>
        <input ref={fileInputRef} type="file" accept="audio/*" style={{ display: 'none' }} onChange={handleFileChange} />

        {phase === 'loading-audio' && <span style={{ color: '#aaa', fontSize: '0.85rem' }}>Decoding audio…</span>}
        {phase === 'model-loading' && <span style={{ color: '#aaa', fontSize: '0.85rem' }}>Downloading Whisper model… {modelProgress}%</span>}
        {phase === 'transcribing' && <span style={{ color: '#aaa', fontSize: '0.85rem' }}>Transcribing…</span>}
        {phase === 'error' && <span style={{ color: '#e74c3c', fontSize: '0.85rem' }}>Error: {errorMsg}</span>}
        {phase === 'ready' && audioUrl && (
          <audio
            ref={audioRef}
            src={audioUrl}
            controls
            style={{ height: 32, flex: 1, minWidth: 0 }}
            onPlay={handleAudioPlay}
            onPause={handleAudioPause}
            onEnded={handleAudioEnded}
          />
        )}
      </div>

      <div style={{ flex: 1, overflow: 'hidden' }}>
        {phase === 'ready' ? (
          <TranscriptViewer
            key={transcript}
            initialText={transcript}
            initialRawText={vttText || undefined}
            initialDuration={audioDuration}
            externalPosition={externalPosition}
            externalPlaying={externalPlaying}
            onScrub={handleScrub}
            onPlayingChange={handlePlayingChange}
          />
        ) : (
          <TranscriptViewer />
        )}
      </div>
    </div>
  )
}
