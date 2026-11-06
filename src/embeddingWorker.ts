import { UMAP } from 'umap-js'
import type { WorkerCommand, WorkerEvent } from './embeddingWorker.types'
import { loadTransformers } from './loadTransformers'
import { createLiveLayout } from './liveLayout'

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnyPipeline = any

const pipelineCache = new Map<string, AnyPipeline>()

async function getPipeline(modelId: string): Promise<AnyPipeline> {
  if (!pipelineCache.has(modelId)) {
    const { pipeline } = await loadTransformers()
    const instance = await pipeline('feature-extraction', modelId, {
      progress_callback: (info: unknown) => {
        const pct = (info as { progress?: number })?.progress ?? 0
        self.postMessage({ type: 'progress:model-loading', progress: Math.round(pct) } satisfies WorkerEvent)
      },
    })
    pipelineCache.set(modelId, instance)
  }
  return pipelineCache.get(modelId)!
}

// Live (incremental) layouts: one session per worker, see liveLayout.ts
const live = createLiveLayout()

self.onmessage = async (e: MessageEvent<WorkerCommand>) => {
  const cmd = e.data
  if (cmd.type === 'embed') {
    try {
      const pipe = await getPipeline(cmd.modelId)
      const vectors: Float32Array[] = []
      for (let i = 0; i < cmd.texts.length; i++) {
        self.postMessage({ type: 'progress:embedding', loaded: i, total: cmd.texts.length } satisfies WorkerEvent)
        const output = await pipe(cmd.texts[i], { pooling: 'mean', normalize: true })
        vectors.push(output.data as Float32Array)
      }

      self.postMessage({ type: 'progress:umap-running' } satisfies WorkerEvent)
      const n = vectors.length
      const data = vectors.map(v => Array.from(v))
      const umap = new UMAP({ nComponents: 3, nNeighbors: Math.min(15, n - 1), minDist: 0.1 })
      const result = umap.fit(data)
      self.postMessage({ type: 'done', points: result as [number, number, number][] } satisfies WorkerEvent)
    } catch (err) {
      self.postMessage({ type: 'error', message: String(err) } satisfies WorkerEvent)
    }
  } else {
    // Run live commands strictly in order: a reset arriving mid-update must not
    // interleave with the update's awaits.
    liveQueue = liveQueue.then(() => handleLive(cmd))
  }
}

let liveQueue: Promise<void> = Promise.resolve()
let liveModelId: string | null = null

async function handleLive(cmd: Exclude<WorkerCommand, { type: 'embed' }>) {
  if (cmd.type === 'live-reset') {
    live.reset()
    liveModelId = null
  } else {
    try {
      if (liveModelId !== cmd.modelId) { live.reset(); liveModelId = cmd.modelId }
      const pipe = await getPipeline(cmd.modelId)
      for (let i = live.count(); i < cmd.texts.length; i++) {
        const output = await pipe(cmd.texts[i], { pooling: 'mean', normalize: true })
        live.add(output.data as Float32Array)
      }
      const points = live.layout()
      self.postMessage({ type: 'live-done', requestId: cmd.requestId, points } satisfies WorkerEvent)
    } catch (err) {
      self.postMessage({ type: 'live-error', requestId: cmd.requestId, message: String(err) } satisfies WorkerEvent)
    }
  }
}
