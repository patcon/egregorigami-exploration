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
        language: 'english',
        chunk_length_s: 30,
        stride_length_s: 5,
      })
      const text = typeof result === 'string' ? result : (result as { text: string }).text
      self.postMessage({ type: 'done', text } satisfies TranscriptionEvent)
    } catch (err) {
      self.postMessage({ type: 'error', message: String(err) } satisfies TranscriptionEvent)
    }
  }
}
