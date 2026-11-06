import { fetchTranscriptResponse } from '../server/transcript'
import { debugTranscript } from './debug'

interface Env {
  ASSETS: Fetcher
}

export default {
  async fetch(request, env): Promise<Response> {
    const url = new URL(request.url)
    if (url.pathname === '/api/transcript') {
      const { status, body } = await fetchTranscriptResponse(url.searchParams.get('videoId'))
      return Response.json(body, { status })
    }
    if (url.pathname === '/api/debug-transcript') {
      const videoId = url.searchParams.get('videoId')
      if (!videoId) return Response.json({ error: 'Missing videoId' }, { status: 400 })
      return Response.json(await debugTranscript(videoId, request.cf?.colo))
    }
    return env.ASSETS.fetch(request)
  },
} satisfies ExportedHandler<Env>
