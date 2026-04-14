export type TranscriptionCommand =
  | { type: 'transcribe'; audioData: Float32Array; modelId: string }

export type TranscriptionEvent =
  | { type: 'progress:model-loading'; progress: number }
  | { type: 'progress:transcribing' }
  | { type: 'done'; text: string }
  | { type: 'error'; message: string }
