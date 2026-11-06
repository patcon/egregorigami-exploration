import { fetchTranscriptResponse } from '../server/transcript'

interface Env {
  ASSETS: Fetcher
  TRANSCRIPTS: KVNamespace
  SUPADATA_API_KEY?: string
}

// Bump to invalidate every cached transcript (e.g. if the response shape changes).
const CACHE_VERSION = 'v1'

async function handleTranscript(videoId: string | null, env: Env): Promise<Response> {
  if (!videoId) return Response.json({ error: 'Missing videoId' }, { status: 400 })

  const key = `transcript:${CACHE_VERSION}:${videoId}`
  const cached = await env.TRANSCRIPTS.get(key)
  if (cached) {
    return new Response(cached, { headers: { 'Content-Type': 'application/json', 'X-Transcript-Cache': 'HIT' } })
  }

  const { status, body } = await fetchTranscriptResponse(videoId, { supadataApiKey: env.SUPADATA_API_KEY })
  const json = JSON.stringify(body)
  // Only successful transcripts are cached (no expiry), so a video is fetched at most once.
  if (status === 200) await env.TRANSCRIPTS.put(key, json)
  return new Response(json, { status, headers: { 'Content-Type': 'application/json', 'X-Transcript-Cache': 'MISS' } })
}

export default {
  async fetch(request, env): Promise<Response> {
    const url = new URL(request.url)
    if (url.pathname === '/api/transcript') return handleTranscript(url.searchParams.get('videoId'), env)
    return env.ASSETS.fetch(request)
  },
} satisfies ExportedHandler<Env>
