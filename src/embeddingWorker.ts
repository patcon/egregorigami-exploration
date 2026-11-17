import { UMAP } from 'umap-js'
import type { WorkerCommand, WorkerEvent } from './embeddingWorker.types'
import { getEmbedder } from './embedder'
import { alignToDisplayed, createLiveLayout, type LiveLayout } from './liveLayout'
import type { Vec3 } from './procrustes'
import { umapDistanceFn, type UmapMetric } from './umapMetric'

const embedderFor = (modelId: string) =>
  getEmbedder(modelId, progress => self.postMessage({ type: 'progress:model-loading', progress } satisfies WorkerEvent))

// Live (incremental) layouts, see liveLayout.ts. Every text is embedded once
// (whether or not its track is visible); each set of visible tracks gets its own
// warm-startable layout, kept until reset so toggling a track back is quick.
const LIVE_MIN_POINTS = 5
type MaskLayout = { layout: LiveLayout; indices: number[]; scanned: number }
let vectors: Float32Array[] = []
let layouts = new Map<string, MaskLayout>()
/** Positions last sent to the view, by text index (the frame the next result is aligned to). */
let displayed = new Map<number, Vec3>()
let liveMetric: UmapMetric = 'cosine'

function resetLive() {
  vectors = []
  layouts = new Map()
  displayed = new Map()
}

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
    resetLive()
    liveKey = null
    return
  }
  try {
    const key = `${cmd.modelId}|${cmd.metric}`
    if (liveKey !== key) { resetLive(); liveMetric = cmd.metric; liveKey = key }
    const embed = await embedderFor(cmd.modelId)
    for (let i = vectors.length; i < cmd.texts.length; i++) vectors.push(await embed(cmd.texts[i]))

    const visible = cmd.visible && cmd.tracks ? new Set(cmd.visible) : null
    const maskKey = visible ? [...visible].sort((a, b) => a - b).join(',') : '*'
    let mask = layouts.get(maskKey)
    if (!mask) {
      mask = { layout: createLiveLayout({ metric: liveMetric }), indices: [], scanned: 0 }
      layouts.set(maskKey, mask)
    }
    for (let i = mask.scanned; i < cmd.texts.length; i++) {
      if (!visible || visible.has(cmd.tracks![i])) { mask.indices.push(i); mask.layout.add(vectors[i]) }
    }
    mask.scanned = Math.max(mask.scanned, cmd.texts.length)

    // Too few visible points for UMAP (only possible with a visible-track filter)
    if (visible && mask.indices.length < LIVE_MIN_POINTS) {
      displayed = new Map()
      self.postMessage({ type: 'live-done', requestId: cmd.requestId, points: [], indices: [] } satisfies WorkerEvent)
      return
    }
    // Reuses the cached fit when this set of tracks gained no points since it was last shown
    const raw = mask.layout.fit()
    const points = alignToDisplayed(raw, mask.indices.map(i => displayed.get(i)))
    displayed = new Map(mask.indices.map((i, j) => [i, points[j]]))
    self.postMessage({ type: 'live-done', requestId: cmd.requestId, points, indices: [...mask.indices] } satisfies WorkerEvent)
  } catch (err) {
    self.postMessage({ type: 'live-error', requestId: cmd.requestId, message: String(err) } satisfies WorkerEvent)
  }
}
