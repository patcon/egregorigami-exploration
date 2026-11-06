import { fetchTranscriptResponse } from '../server/transcript'

interface Env {
  ASSETS: Fetcher
  SUPADATA_API_KEY?: string
}

export default {
  async fetch(request, env): Promise<Response> {
    const url = new URL(request.url)
    if (url.pathname === '/api/transcript') {
      const { status, body } = await fetchTranscriptResponse(url.searchParams.get('videoId'), {
        supadataApiKey: env.SUPADATA_API_KEY,
      })
      return Response.json(body, { status })
    }
    return env.ASSETS.fetch(request)
  },
} satisfies ExportedHandler<Env>
