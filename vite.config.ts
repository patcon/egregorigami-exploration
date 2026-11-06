import { defineConfig, type Plugin } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import { fetchTranscriptResponse } from './server/transcript'

// ONNX Runtime's code references its .wasm via `new URL(..., import.meta.url)`, so
// Vite copies the ~22 MB file into dist/ even though we load it from jsDelivr at
// runtime (src/loadTransformers.ts). Drop the unused copy from the build output.
const dropBundledOrtWasm = (): Plugin => ({
  name: 'drop-bundled-ort-wasm',
  apply: 'build',
  generateBundle(_, bundle) {
    for (const file of Object.keys(bundle)) {
      if (/ort-wasm[^/]*\.wasm$/.test(file)) delete bundle[file]
    }
  },
})

// https://vite.dev/config/
export default defineConfig({
  base: process.env.VITE_BASE ?? '/egregorigami-exploration/',
  optimizeDeps: { exclude: ['@huggingface/transformers'] },
  worker: { plugins: () => [dropBundledOrtWasm()] },
  plugins: [
    dropBundledOrtWasm(),
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
