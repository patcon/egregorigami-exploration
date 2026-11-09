import { UMAP } from 'umap-js'
import type { WorkerCommand, WorkerEvent } from './embeddingWorker.types'
import { getEmbedder } from './embedder'
import { createLiveLayout } from './liveLayout'
import { umapDistanceFn } from './umapMetric'

const embedderFor = (modelId: string) =>
  getEmbedder(modelId, progress => self.postMessage({ type: 'progress:model-loading', progress } satisfies WorkerEvent))

// Live (incremental) layouts: one session per worker, see liveLayout.ts
let live = createLiveLayout()

self.onmessage = async (e: MessageEvent<WorkerCommand>) => {
  const cmd = e.data
  if (cmd.type === 'embed') {
    try {
      const embed = await embedderFor(cmd.modelId)
      const vectors: Float32Array[] = []
      for (let i = 0; i < cmd.texts.length; i++) {
        self.postMessage({ type: 'progress:embedding', loaded: i, total: cmd.texts.length } satisfies WorkerEvent)
        vectors.push(await embed(cmd.texts[i]))
      }

      self.postMessage({ type: 'progress:umap-running' } satisfies WorkerEvent)
      const n = vectors.length
      const data = vectors.map(v => Array.from(v))
      const umap = new UMAP({ nComponents: 3, nNeighbors: Math.min(15, n - 1), minDist: 0.1, distanceFn: umapDistanceFn(cmd.metric) })
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
let liveKey: string | null = null // model + metric of the current live session

async function handleLive(cmd: Exclude<WorkerCommand, { type: 'embed' }>) {
  if (cmd.type === 'live-reset') {
    live.reset()
    liveKey = null
  } else {
    try {
      const key = `${cmd.modelId}|${cmd.metric}`
      if (liveKey !== key) { live = createLiveLayout({ metric: cmd.metric }); liveKey = key }
      const embed = await embedderFor(cmd.modelId)
      for (let i = live.count(); i < cmd.texts.length; i++) {
        live.add(await embed(cmd.texts[i]))
      }
      const points = live.layout()
      self.postMessage({ type: 'live-done', requestId: cmd.requestId, points } satisfies WorkerEvent)
    } catch (err) {
      self.postMessage({ type: 'live-error', requestId: cmd.requestId, message: String(err) } satisfies WorkerEvent)
    }
  }
}
