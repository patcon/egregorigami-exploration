import { fetchTranscriptResponse } from '../server/transcript'

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
    return env.ASSETS.fetch(request)
  },
} satisfies ExportedHandler<Env>
