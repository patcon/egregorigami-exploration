import { useState } from 'react'

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

export function useUrlHistory() {
  const [history, setHistory] = useState<UrlHistoryEntry[]>(loadHistory)

  function addToHistory(url: string, videoId: string) {
    setHistory(prev => {
      const filtered = prev.filter(e => e.url !== url)
      // Preserve existing title if this URL was already in history
      const existing = prev.find(e => e.url === url)
      const entry: UrlHistoryEntry = { url, videoId, title: existing?.title }
      const next = [entry, ...filtered].slice(0, MAX_HISTORY)
      persistHistory(next)
      // Fetch title async if not already known
      if (!existing?.title) {
        fetchOembedTitle(url).then(title => {
          if (!title) return
          setHistory(h => {
            const updated = h.map(e => e.url === url ? { ...e, title } : e)
            persistHistory(updated)
            return updated
          })
        })
      }
      return next
    })
  }

  return { history, addToHistory }
}
