import { fetchTranscriptResponse } from '../server/transcript'

interface Env {
  ASSETS: Fetcher
  TRANSCRIPTS: KVNamespace
  SUPADATA_API_KEY?: string
}

// Bump to invalidate every cached transcript (e.g. if the response shape changes).
const CACHE_VERSION = 'v1'
// "No transcript" answers expire, in case captions get added later.
const UNAVAILABLE_TTL_SECS = 60 * 60 * 24

const jsonHeaders = (cache: 'HIT' | 'MISS') => ({ 'Content-Type': 'application/json', 'X-Transcript-Cache': cache })

async function handleTranscript(videoId: string | null, env: Env): Promise<Response> {
  if (!videoId) return Response.json({ error: 'Missing videoId' }, { status: 400 })

  const okKey = `transcript:${CACHE_VERSION}:${videoId}`
  const unavailableKey = `unavailable:${CACHE_VERSION}:${videoId}`
  const [ok, unavailable] = await Promise.all([env.TRANSCRIPTS.get(okKey), env.TRANSCRIPTS.get(unavailableKey)])
  if (ok) return new Response(ok, { headers: jsonHeaders('HIT') })
  if (unavailable) return new Response(unavailable, { status: 404, headers: jsonHeaders('HIT') })

  const { status, body } = await fetchTranscriptResponse(videoId, { supadataApiKey: env.SUPADATA_API_KEY })
  const json = JSON.stringify(body)
  // Successes are cached forever (each video fetched at most once); "no transcript"
  // (404) for a day; transient failures (500) never.
  if (status === 200) await env.TRANSCRIPTS.put(okKey, json)
  if (status === 404) await env.TRANSCRIPTS.put(unavailableKey, json, { expirationTtl: UNAVAILABLE_TTL_SECS })
  return new Response(json, { status, headers: jsonHeaders('MISS') })
}

export default {
  async fetch(request, env): Promise<Response> {
    const url = new URL(request.url)
    if (url.pathname === '/api/transcript') return handleTranscript(url.searchParams.get('videoId'), env)
    if (url.pathname.startsWith('/api/')) return Response.json({ error: 'Not found' }, { status: 404 })
    return env.ASSETS.fetch(request)
  },
} satisfies ExportedHandler<Env>
