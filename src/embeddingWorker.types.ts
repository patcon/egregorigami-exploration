import type { UmapMetric } from './umapMetric'

export type WorkerCommand =
  | { type: 'embed'; texts: string[]; modelId: string; metric?: UmapMetric }
  /**
   * Incremental: embed only texts not yet seen this session, then re-layout stably.
   * With `tracks` (the track of each text) and `visible`, only texts on visible
   * tracks are laid out; the rest are still embedded, ready for when they're shown.
   */
  | { type: 'live-update'; requestId: number; texts: string[]; modelId: string; metric: UmapMetric; tracks?: number[]; visible?: number[] }
  | { type: 'live-reset' }

export type WorkerEvent =
  | { type: 'progress:model-loading'; progress: number }
  | { type: 'progress:embedding'; loaded: number; total: number }
  | { type: 'progress:umap-running' }
  | { type: 'done'; points: [number, number, number][] }
  | { type: 'error'; message: string }
  /** `indices[i]` is the index (into the update's `texts`) of `points[i]`. */
  | { type: 'live-done'; requestId: number; points: [number, number, number][]; indices: number[] }
  | { type: 'live-error'; requestId: number; message: string }
