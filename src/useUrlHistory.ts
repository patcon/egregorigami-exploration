import { useEffect, useState } from 'react'

export type UrlHistoryEntry = { url: string; videoId: string; title?: string }

const HISTORY_KEY = 'yt-url-history'
const MAX_HISTORY = 15

function loadHistory(): UrlHistoryEntry[] {
  try { return JSON.parse(localStorage.getItem(HISTORY_KEY) ?? '[]') }
  catch { return [] }
}

function persistHistory(entries: UrlHistoryEntry[]) {
  localStorage.setItem(HISTORY_KEY, JSON.stringify(entries))
}

async function fetchOembedTitle(url: string): Promise<string | null> {
  try {
    const res = await fetch(`https://www.youtube.com/oembed?url=${encodeURIComponent(url)}&format=json`)
    if (!res.ok) return null
    const data = await res.json()
    return typeof data.title === 'string' ? data.title : null
  } catch { return null }
}

export function useUrlHistory(url: string, videoId: string | null) {
  const [history, setHistory] = useState<UrlHistoryEntry[]>(loadHistory)

  // Move the video to the top when it changes. Done during render (React's
  // "adjust state when a prop changes" pattern) rather than in an effect.
  const [lastVideoId, setLastVideoId] = useState<string | null>(null)
  if (videoId && videoId !== lastVideoId) {
    setLastVideoId(videoId)
    setHistory(prev => {
      const existing = prev.find(e => e.videoId === videoId)
      const entry: UrlHistoryEntry = { url, videoId, title: existing?.title }
      return [entry, ...prev.filter(e => e.videoId !== videoId)].slice(0, MAX_HISTORY)
    })
  }

  useEffect(() => { persistHistory(history) }, [history])

  // Fill in the title asynchronously for entries that don't have one yet
  const needsTitle = !!videoId && !history.find(e => e.videoId === videoId)?.title
  useEffect(() => {
    if (!videoId || !needsTitle) return
    let cancelled = false
    fetchOembedTitle(url).then(title => {
      if (cancelled || !title) return
      setHistory(h => h.map(e => e.videoId === videoId ? { ...e, title } : e))
    })
    return () => { cancelled = true }
  // Keyed on the video, not every keystroke in the URL field
  }, [videoId, needsTitle]) // eslint-disable-line react-hooks/exhaustive-deps

  return { history }
}
