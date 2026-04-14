export type TranscriptionChunk = { text: string; timestamp: [number, number | null] }

export type TranscriptionCommand =
  | { type: 'transcribe'; audioData: Float32Array; modelId: string }

export type TranscriptionEvent =
  | { type: 'progress:model-loading'; progress: number }
  | { type: 'progress:transcribing' }
  | { type: 'done'; text: string; chunks: TranscriptionChunk[] }
  | { type: 'error'; message: string }
