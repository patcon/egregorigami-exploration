import type { TranscriptionCommand, TranscriptionEvent } from './transcriptionWorker.types'

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnyPipeline = any

const pipelineCache = new Map<string, AnyPipeline>()

self.onmessage = async (e: MessageEvent<TranscriptionCommand>) => {
  const cmd = e.data
  if (cmd.type === 'transcribe') {
    try {
      if (!pipelineCache.has(cmd.modelId)) {
        const { pipeline } = await import('@huggingface/transformers')
        const instance = await pipeline('automatic-speech-recognition', cmd.modelId, {
          progress_callback: (info: unknown) => {
            const pct = (info as { progress?: number })?.progress ?? 0
            self.postMessage({ type: 'progress:model-loading', progress: Math.round(pct) } satisfies TranscriptionEvent)
          },
        })
        pipelineCache.set(cmd.modelId, instance)
      }

      const pipe = pipelineCache.get(cmd.modelId)!
      self.postMessage({ type: 'progress:transcribing' } satisfies TranscriptionEvent)
      const result = await pipe(cmd.audioData, {
        chunk_length_s: 20,
        stride_length_s: 3,
        sampling_rate: 16000,
      })
      // Log raw result shape to help debug missing text
      console.log('[transcriptionWorker] result type:', typeof result, Array.isArray(result) ? 'array' : '')
      console.log('[transcriptionWorker] result:', JSON.stringify(result).slice(0, 500))

      // transformers.js v3 may return a single object or an array of chunks
      let text: string
      if (typeof result === 'string') {
        text = result
      } else if (Array.isArray(result)) {
        text = (result as Array<{ text: string }>).map(r => r.text).join(' ')
      } else {
        text = (result as { text: string }).text
      }
      console.log('[transcriptionWorker] extracted text length:', text?.length, 'preview:', text?.slice(0, 100))
      self.postMessage({ type: 'done', text } satisfies TranscriptionEvent)
    } catch (err) {
      self.postMessage({ type: 'error', message: String(err) } satisfies TranscriptionEvent)
    }
  }
}
