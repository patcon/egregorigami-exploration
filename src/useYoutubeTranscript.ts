import { useState, useCallback } from 'react'
import { buildTranscriptData, segmentsToVtt } from './subtitleParser'
import { extractVideoId } from './videoUtils'

export type TranscriptLoadedResult = {
  text: string
  duration: string
  videoId: string
  wordTimestamps: number[]
}

export type SubtitleLoadResult = {
  text: string
  wordTimestamps: number[]
  durationSecs: number
}

export function useYoutubeTranscript(
  urlInput: string,
  options?: {
    onLoaded?: (result: TranscriptLoadedResult) => void
    onSubtitleLoaded?: (result: SubtitleLoadResult) => void
  },
) {
  const [loadedText, setLoadedText] = useState<string | null>(() => localStorage.getItem('yt-transcript'))
  const [loadedDuration, setLoadedDuration] = useState<string | null>(() => localStorage.getItem('yt-duration'))
  const [loadedVideoId, setLoadedVideoId] = useState<string | null>(() =>
    extractVideoId(localStorage.getItem('yt-url') ?? '') ? localStorage.getItem('yt-video-id') : null
  )
  const [loadCount, setLoadCount] = useState(0)
  const [status, setStatus] = useState<'idle' | 'loading' | 'error'>('idle')
  const [errorMessage, setErrorMessage] = useState('')
  const [wordTimestamps, setWordTimestamps] = useState<number[] | null>(
    () => JSON.parse(localStorage.getItem('yt-word-timestamps') ?? 'null')
  )

  const handleLoad = useCallback(async () => {
    const videoId = extractVideoId(urlInput)
    if (!videoId) {
      setStatus('error')
      setErrorMessage('Could not extract a video ID from the input.')
      return
    }
    setStatus('loading')
    setErrorMessage('')
    try {
      const res = await fetch(`/api/transcript?videoId=${encodeURIComponent(videoId)}`)
      const data = await res.json()
      if (!res.ok) throw new Error(data.error ?? `HTTP ${res.status}`)
      const { text, wordTimestamps: wt } = buildTranscriptData(data.segments)
      const duration = String(Math.round(data.totalDuration))
      setLoadedText(text)
      setLoadedDuration(duration)
      setLoadedVideoId(videoId)
      setWordTimestamps(wt)
      setLoadCount(c => c + 1)
      localStorage.setItem('yt-url', urlInput)
      localStorage.setItem('yt-transcript', text)
      localStorage.setItem('yt-duration', duration)
      localStorage.setItem('yt-video-id', videoId)
      localStorage.setItem('yt-word-timestamps', JSON.stringify(wt))
      localStorage.setItem('transcript-raw-text', segmentsToVtt(data.segments))
      setStatus('idle')
      options?.onLoaded?.({ text, duration, videoId, wordTimestamps: wt })
    } catch (e) {
      setStatus('error')
      setErrorMessage(String(e))
    }
  }, [urlInput, options?.onLoaded]) // eslint-disable-line react-hooks/exhaustive-deps

  const handleSubtitleLoad = useCallback((result: SubtitleLoadResult) => {
    setLoadedText(result.text)
    setLoadedDuration(String(result.durationSecs))
    setWordTimestamps(result.wordTimestamps)
    setLoadedVideoId(null)
    setLoadCount(c => c + 1)
    localStorage.setItem('yt-transcript', result.text)
    localStorage.setItem('yt-duration', String(result.durationSecs))
    localStorage.setItem('yt-word-timestamps', JSON.stringify(result.wordTimestamps))
    localStorage.removeItem('yt-video-id')
    options?.onSubtitleLoaded?.(result)
  }, [options?.onSubtitleLoaded]) // eslint-disable-line react-hooks/exhaustive-deps

  return {
    loadedText, loadedDuration, loadedVideoId, wordTimestamps, loadCount, status, errorMessage,
    handleLoad, handleSubtitleLoad,
    setLoadedText, setLoadedDuration, setLoadedVideoId, setWordTimestamps, setLoadCount,
  }
}
