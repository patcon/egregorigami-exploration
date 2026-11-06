import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import { fetchTranscriptResponse } from './server/transcript'

// https://vite.dev/config/
export default defineConfig({
  base: process.env.VITE_BASE ?? '/egregorigami-exploration/',
  optimizeDeps: { exclude: ['@huggingface/transformers'] },
  plugins: [
    tailwindcss(),
    react(),
    {
      name: 'transcript-api',
      configureServer(server) {
        server.middlewares.use('/api/transcript', async (req, res) => {
          const url = new URL(req.url!, `http://${req.headers.host}`)
          const { status, body } = await fetchTranscriptResponse(url.searchParams.get('videoId'))
          res.writeHead(status, { 'Content-Type': 'application/json' })
          res.end(JSON.stringify(body))
        })
      }
    }
  ],
})
