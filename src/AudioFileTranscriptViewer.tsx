import { useState, useRef, useCallback, useEffect } from 'react'
import TranscriptViewer from './TranscriptViewer'
import TranscriptionWorker from './transcriptionWorker?worker'
import type { TranscriptionEvent } from './transcriptionWorker.types'

const MODELS = [
  { id: 'Xenova/whisper-tiny.en', label: 'tiny.en (~150MB)' },
  { id: 'Xenova/whisper-base.en', label: 'base.en (~290MB)' },
  { id: 'Xenova/whisper-small.en', label: 'small.en (~970MB)' },
]

type Phase = 'idle' | 'loading-audio' | 'model-loading' | 'transcribing' | 'ready' | 'error'

export default function AudioFileTranscriptViewer() {
  const [phase, setPhase] = useState<Phase>('idle')
  const [modelId, setModelId] = useState(MODELS[0].id)
  const [modelProgress, setModelProgress] = useState(0)
  const [errorMsg, setErrorMsg] = useState('')
  const [transcript, setTranscript] = useState('')
  const [audioDuration, setAudioDuration] = useState('')
  const [audioUrl, setAudioUrl] = useState<string | null>(null)
  const [externalPosition, setExternalPosition] = useState<number | undefined>(undefined)
  const [externalPlaying, setExternalPlaying] = useState<boolean | undefined>(undefined)

  const fileInputRef = useRef<HTMLInputElement>(null)
  const audioRef = useRef<HTMLAudioElement>(null)
  const workerRef = useRef<Worker | null>(null)
  const rafRef = useRef<number | null>(null)
  const prevUrlRef = useRef<string | null>(null)

  // Cleanup object URL on unmount or when it changes
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

    // Revoke previous object URL
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
    setExternalPosition(undefined)
    setExternalPlaying(undefined)

    try {
      // Decode audio
      const arrayBuffer = await file.arrayBuffer()
      const audioCtx = new AudioContext()
      const audioBuffer = await audioCtx.decodeAudioData(arrayBuffer)
      await audioCtx.close()

      // Resample to 16kHz mono for Whisper
      const targetSampleRate = 16000
      const length = Math.ceil(audioBuffer.duration * targetSampleRate)
      const offlineCtx = new OfflineAudioContext(1, length, targetSampleRate)
      const src = offlineCtx.createBufferSource()
      src.buffer = audioBuffer
      src.connect(offlineCtx.destination)
      src.start()
      const resampled = await offlineCtx.startRendering()
      const float32 = resampled.getChannelData(0)

      // Create playback URL
      const url = URL.createObjectURL(file)
      prevUrlRef.current = url
      setAudioUrl(url)
      setAudioDuration(String(Math.round(audioBuffer.duration)))

      // Start worker
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
          // Clear localStorage so TranscriptViewer's initialText takes priority over stale cache
          localStorage.removeItem('transcript-raw-text')
          localStorage.removeItem('transcript-text')
          setTranscript(msg.text.trim())
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
  }, [])

  // Drive externalPosition via rAF while audio is playing
  const syncPosition = useCallback(() => {
    const audio = audioRef.current
    if (!audio || audio.paused || !isFinite(audio.duration) || audio.duration === 0) return
    setExternalPosition(audio.currentTime / audio.duration)
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
      setExternalPosition(audio.currentTime / audio.duration)
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

  // TranscriptViewer scrub bar → seek audio
  const handleScrub = useCallback((pos: number) => {
    const audio = audioRef.current
    if (audio && isFinite(audio.duration)) {
      audio.currentTime = pos * audio.duration
    }
    setExternalPosition(pos)
  }, [])

  // TranscriptViewer play/pause button → control audio
  const handlePlayingChange = useCallback((playing: boolean) => {
    const audio = audioRef.current
    if (!audio) return
    if (playing) {
      audio.play().catch(() => {})
    } else {
      audio.pause()
    }
  }, [])

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100dvh' }}>
      {/* Toolbar */}
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

        {phase === 'loading-audio' && (
          <span style={{ color: '#aaa', fontSize: '0.85rem' }}>Decoding audio…</span>
        )}
        {phase === 'model-loading' && (
          <span style={{ color: '#aaa', fontSize: '0.85rem' }}>Downloading Whisper model… {modelProgress}%</span>
        )}
        {phase === 'transcribing' && (
          <span style={{ color: '#aaa', fontSize: '0.85rem' }}>Transcribing…</span>
        )}
        {phase === 'error' && (
          <span style={{ color: '#e74c3c', fontSize: '0.85rem' }}>Error: {errorMsg}</span>
        )}
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

      {/* Transcript viewer */}
      <div style={{ flex: 1, overflow: 'hidden' }}>
        {phase === 'ready' ? (
          <TranscriptViewer
            key={transcript}
            initialText={transcript}
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
