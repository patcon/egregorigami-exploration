import { YoutubeTranscript } from 'youtube-transcript-plus'

const input = process.argv[2]
if (!input) {
  console.error('Usage: npm run extract-transcript -- <youtube-url-or-video-id>')
  process.exit(1)
}

function extractVideoId(url) {
  try {
    const u = new URL(url.trim())
    if (u.hostname === 'youtu.be') return u.pathname.slice(1)
    if (u.hostname.includes('youtube.com')) return u.searchParams.get('v')
    return null
  } catch {
    return /^[a-zA-Z0-9_-]{11}$/.test(url.trim()) ? url.trim() : null
  }
}

const videoId = extractVideoId(input) ?? input
const segments = await YoutubeTranscript.fetchTranscript(videoId)
const text = segments.map(s => s.text).join(' ')
process.stdout.write(text + '\n')
