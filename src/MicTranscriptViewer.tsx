import { useState, useEffect, useRef, useCallback } from 'react'
import TranscriptViewer from './TranscriptViewer'

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnyRecognition = any

function getSpeechRecognition(): AnyRecognition | null {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const w = window as any
  return w.SpeechRecognition ?? w.webkitSpeechRecognition ?? null
}

export default function MicTranscriptViewer() {
  const [isRecording, setIsRecording] = useState(false)
  const [finalTranscript, setFinalTranscript] = useState('')
  const [interimTranscript, setInterimTranscript] = useState('')
  const [recordedDuration, setRecordedDuration] = useState<number | null>(null)
  const [viewerKey, setViewerKey] = useState(0)
  const [viewerText, setViewerText] = useState('')
  const [viewerDuration, setViewerDuration] = useState('')
  const [supported] = useState(() => !!getSpeechRecognition())

  const recognitionRef = useRef<AnyRecognition>(null)
  const startTimeRef = useRef<number | null>(null)
  const finalRef = useRef('')

  const startRecording = useCallback(() => {
    const SR = getSpeechRecognition()
    if (!SR) return

    const recognition = new SR()
    recognition.continuous = true
    recognition.interimResults = true
    recognition.lang = 'en-US'

    finalRef.current = ''

    recognition.onresult = (event: AnyRecognition) => {
      let interim = ''
      for (let i = event.resultIndex; i < event.results.length; i++) {
        const result = event.results[i]
        if (result.isFinal) {
          finalRef.current += result[0].transcript + ' '
        } else {
          interim += result[0].transcript
        }
      }
      setFinalTranscript(finalRef.current)
      setInterimTranscript(interim)
    }

    recognition.onerror = (event: AnyRecognition) => {
      console.error('SpeechRecognition error', event.error)
      setIsRecording(false)
    }

    recognition.onend = () => {
      const elapsed = startTimeRef.current ? (Date.now() - startTimeRef.current) / 1000 : 0
      setRecordedDuration(elapsed)
      setIsRecording(false)
    }

    recognitionRef.current = recognition
    startTimeRef.current = Date.now()
    setFinalTranscript('')
    setInterimTranscript('')
    recognition.start()
    setIsRecording(true)
  }, [])

  const stopRecording = useCallback(() => {
    recognitionRef.current?.stop()
  }, [])

  useEffect(() => {
    if (!isRecording && finalRef.current && recordedDuration !== null) {
      const text = finalRef.current.trim()
      const duration = String(Math.max(1, Math.round(recordedDuration)))
      setViewerText(text)
      setViewerDuration(duration)
      setViewerKey(k => k + 1)
    }
  }, [isRecording, recordedDuration])

  if (!supported) {
    return (
      <div style={{ padding: '2rem', textAlign: 'center', color: '#ccc' }}>
        <p>Your browser does not support the Web Speech API. Try Chrome or Edge.</p>
      </div>
    )
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100dvh' }}>
      <div style={{ padding: '0.5rem 1rem', display: 'flex', alignItems: 'center', gap: '1rem', background: '#111', flexShrink: 0 }}>
        <button
          onClick={isRecording ? stopRecording : startRecording}
          style={{
            padding: '0.35rem 0.9rem',
            background: isRecording ? '#c0392b' : '#27ae60',
            color: '#fff',
            border: 'none',
            borderRadius: 4,
            cursor: 'pointer',
            fontWeight: 'bold',
            fontSize: '0.9rem',
          }}
        >
          {isRecording ? 'Stop' : 'Record'}
        </button>
        {isRecording && (
          <span style={{ color: '#e74c3c', fontFamily: 'monospace', fontSize: '0.85rem' }}>
            ● Recording
          </span>
        )}
        {isRecording && (finalTranscript || interimTranscript) && (
          <span style={{ color: '#aaa', fontSize: '0.8rem', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', flex: 1, minWidth: 0 }}>
            {finalTranscript}
            <em style={{ color: '#555' }}>{interimTranscript}</em>
          </span>
        )}
        {!isRecording && viewerText && (
          <span style={{ color: '#666', fontSize: '0.8rem' }}>
            {viewerDuration}s recorded — transcript loaded below
          </span>
        )}
      </div>
      <div style={{ flex: 1, overflow: 'hidden' }}>
        <TranscriptViewer
          key={viewerKey}
          initialText={viewerText || undefined}
          initialDuration={viewerDuration || undefined}
        />
      </div>
    </div>
  )
}
