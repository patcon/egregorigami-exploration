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

  useEffect(() => {
    if (!videoId) return
    setHistory(prev => {
      const existing = prev.find(e => e.videoId === videoId)
      const entry: UrlHistoryEntry = { url, videoId, title: existing?.title }
      const next = [entry, ...prev.filter(e => e.videoId !== videoId)].slice(0, MAX_HISTORY)
      persistHistory(next)
      if (!existing?.title) {
        fetchOembedTitle(url).then(title => {
          if (!title) return
          setHistory(h => {
            const updated = h.map(e => e.videoId === videoId ? { ...e, title } : e)
            persistHistory(updated)
            return updated
          })
        })
      }
      return next
    })
  }, [videoId]) // eslint-disable-line react-hooks/exhaustive-deps

  return { history }
}
