import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import { YoutubeTranscript } from 'youtube-transcript-plus'

// https://vite.dev/config/
export default defineConfig({
  base: '/egregorigami-exploration/',
  optimizeDeps: { exclude: ['@huggingface/transformers'] },
  plugins: [
    tailwindcss(),
    react(),
    {
      name: 'transcript-api',
      configureServer(server) {
        server.middlewares.use('/api/transcript', async (req, res) => {
          const url = new URL(req.url!, `http://${req.headers.host}`)
          const videoId = url.searchParams.get('videoId')
          if (!videoId) {
            res.writeHead(400, { 'Content-Type': 'application/json' })
            res.end(JSON.stringify({ error: 'Missing videoId' }))
            return
          }
          try {
            let segments = await YoutubeTranscript.fetchTranscript(videoId, { lang: 'en' }).catch(
              () => YoutubeTranscript.fetchTranscript(videoId)
            )
            const last = segments[segments.length - 1]
            const totalDuration = last ? last.offset + last.duration : 0
            res.writeHead(200, { 'Content-Type': 'application/json' })
            res.end(JSON.stringify({ segments, totalDuration }))
          } catch (e) {
            res.writeHead(500, { 'Content-Type': 'application/json' })
            res.end(JSON.stringify({ error: String(e) }))
          }
        })
      }
    }
  ],
})
