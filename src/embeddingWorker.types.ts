export type WorkerCommand =
  | { type: 'embed'; texts: string[]; modelId: string }
  /** Incremental: embed only texts not yet seen this session, then re-layout stably. */
  | { type: 'live-update'; requestId: number; texts: string[]; modelId: string }
  | { type: 'live-reset' }

export type WorkerEvent =
  | { type: 'progress:model-loading'; progress: number }
  | { type: 'progress:embedding'; loaded: number; total: number }
  | { type: 'progress:umap-running' }
  | { type: 'done'; points: [number, number, number][] }
  | { type: 'error'; message: string }
  | { type: 'live-done'; requestId: number; points: [number, number, number][] }
  | { type: 'live-error'; requestId: number; message: string }
