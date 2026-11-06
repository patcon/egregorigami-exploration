/**
 * True when a `/api/transcript` endpoint is available: always in dev (Vite
 * middleware), and in production builds made with `VITE_TRANSCRIPT_API=true`
 * (the Cloudflare Worker deploy). False on the static GitHub Pages build.
 */
export const hasTranscriptApi = !import.meta.env.PROD || import.meta.env.VITE_TRANSCRIPT_API === 'true'
