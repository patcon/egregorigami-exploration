import { YoutubeTranscript } from 'youtube-transcript-plus'

export type TranscriptSegment = { text: string; offset: number; duration: number; lang?: string }
export type TranscriptResponse = { status: number; body: object }

export type TranscriptOptions = {
  /** When set, fetch via Supadata instead of scraping YouTube directly. */
  supadataApiKey?: string
}

/** Scrape YouTube directly. Works from residential IPs; bot-blocked on most datacenter IPs. */
async function fetchViaYoutube(videoId: string): Promise<TranscriptSegment[]> {
  return YoutubeTranscript.fetchTranscript(videoId, { lang: 'en' }).catch(
    () => YoutubeTranscript.fetchTranscript(videoId)
  )
}

/** The video has no fetchable transcript (vs. a transient failure). Safe to cache. */
export class TranscriptUnavailableError extends Error {}

type SupadataChunk = { text: string; offset: number; duration: number; lang?: string }

/**
 * Fetch existing captions via Supadata (https://docs.supadata.ai). `mode=native`
 * never falls back to paid AI generation, so it also never returns an async job.
 * Supadata times are in milliseconds; convert to seconds to match youtube-transcript-plus.
 */
async function fetchViaSupadata(videoId: string, apiKey: string): Promise<TranscriptSegment[]> {
  const params = new URLSearchParams({
    url: `https://www.youtube.com/watch?v=${videoId}`,
    lang: 'en',
    mode: 'native',
  })
  const res = await fetch(`https://api.supadata.ai/v1/transcript?${params}`, {
    headers: { 'x-api-key': apiKey },
  })
  const data = (await res.json().catch(() => ({}))) as {
    content?: SupadataChunk[]
    error?: string
    message?: string
  }
  if (res.status === 206 || res.status === 404) {
    throw new TranscriptUnavailableError(`Supadata ${res.status}: ${data.error ?? 'transcript-unavailable'}${data.message ? ` — ${data.message}` : ''}`)
  }
  if (res.status !== 200 || !Array.isArray(data.content)) {
    throw new Error(`Supadata ${res.status}: ${data.error ?? 'unexpected response'}${data.message ? ` — ${data.message}` : ''}`)
  }
  return data.content.map(c => ({
    text: c.text,
    offset: c.offset / 1000,
    duration: c.duration / 1000,
    lang: c.lang,
  }))
}

/**
 * Fetch a YouTube transcript and shape the JSON response served at
 * `/api/transcript`. Shared by the Vite dev middleware and the Cloudflare Worker.
 */
export async function fetchTranscriptResponse(
  videoId: string | null,
  options: TranscriptOptions = {},
): Promise<TranscriptResponse> {
  if (!videoId) return { status: 400, body: { error: 'Missing videoId' } }
  try {
    const segments = options.supadataApiKey
      ? await fetchViaSupadata(videoId, options.supadataApiKey)
      : await fetchViaYoutube(videoId)
    const last = segments[segments.length - 1]
    const totalDuration = last ? last.offset + last.duration : 0
    return { status: 200, body: { segments, totalDuration } }
  } catch (e) {
    // 404 = this video has no transcript (cacheable); 500 = transient/unknown failure.
    return { status: e instanceof TranscriptUnavailableError ? 404 : 500, body: { error: String(e) } }
  }
}
