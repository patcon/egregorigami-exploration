import type { TranscriptionChunk, TranscriptionCommand, TranscriptionEvent } from './transcriptionWorker.types'

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

      let text: string
      let chunks: TranscriptionChunk[] = []

      if (typeof result === 'string') {
        text = result
      } else if (Array.isArray(result)) {
        text = (result as Array<{ text: string; chunks?: TranscriptionChunk[] }>).map(r => r.text).join(' ')
        chunks = (result as Array<{ chunks?: TranscriptionChunk[] }>).flatMap(r => r.chunks ?? [])
      } else {
        const r = result as { text: string; chunks?: TranscriptionChunk[] }
        text = r.text
        chunks = r.chunks ?? []
      }

      self.postMessage({ type: 'done', text, chunks } satisfies TranscriptionEvent)
    } catch (err) {
      self.postMessage({ type: 'error', message: String(err) } satisfies TranscriptionEvent)
    }
  }
}
