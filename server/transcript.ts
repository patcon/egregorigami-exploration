import { YoutubeTranscript } from 'youtube-transcript-plus'

export type TranscriptResponse = { status: number; body: object }

/**
 * Fetch a YouTube transcript and shape the JSON response served at
 * `/api/transcript`. Shared by the Vite dev middleware and the Cloudflare Worker.
 */
export async function fetchTranscriptResponse(videoId: string | null): Promise<TranscriptResponse> {
  if (!videoId) return { status: 400, body: { error: 'Missing videoId' } }
  try {
    const segments = await YoutubeTranscript.fetchTranscript(videoId, { lang: 'en' }).catch(
      () => YoutubeTranscript.fetchTranscript(videoId)
    )
    const last = segments[segments.length - 1]
    const totalDuration = last ? last.offset + last.duration : 0
    return { status: 200, body: { segments, totalDuration } }
  } catch (e) {
    return { status: 500, body: { error: String(e) } }
  }
}
