import { UMAP } from 'umap-js'
import { umapDistanceFn, type UmapMetric } from './umapMetric'
import { applyTransform, centreAndScale, fitProcrustes, type Vec3 } from './procrustes'

/** RMS radius of a live layout, in display units. */
const LIVE_RMS_RADIUS = 0.9

export interface LiveLayoutOptions {
  /** Epochs for warm-started runs (cold runs use UMAP's default, 500). */
  warmEpochs?: number
  /** Learning rate for warm-started runs; lower keeps existing points closer to where they were. */
  warmLearningRate?: number
  /** UMAP distance metric (default euclidean). */
  metric?: UmapMetric
}

/** Deterministic PRNG (mulberry32) so repeated runs don't add their own randomness. */
function seededRandom(seed: number) {
  let a = seed >>> 0
  return () => {
    a = (a + 0x6d2b79f5) >>> 0
    let t = a
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

function dot(a: Float32Array, b: Float32Array) {
  let s = 0
  for (let i = 0; i < a.length; i++) s += a[i] * b[i]
  return s
}

/**
 * Stable incremental 3D UMAP for a growing list of (unit-normalised) embedding vectors.
 *
 * Each `fit()` warm-starts UMAP from the previous fit (new points start near
 * their most similar existing points) and returns UMAP's own coordinates. When
 * nothing was added since the last fit, it returns that fit again without
 * re-running UMAP. Use `alignToDisplayed` to turn the result into view coordinates.
 */
export function createLiveLayout({ warmEpochs = 200, warmLearningRate = 0.3, metric = 'cosine' }: LiveLayoutOptions = {}) {
  let vectors: Float32Array[] = []
  let prevRaw: Vec3[] = []      // last UMAP output, in UMAP's own coordinates

  /** Starting position for a new point: mean of its 3 most similar already-placed points. */
  const seedPosition = (vec: Float32Array, placed: number, rand: () => number): Vec3 => {
    const sims: { i: number; s: number }[] = []
    for (let i = 0; i < placed; i++) sims.push({ i, s: dot(vec, vectors[i]) })
    sims.sort((x, y) => y.s - x.s)
    const top = sims.slice(0, 3)
    const p: Vec3 = [0, 0, 0]
    for (const { i } of top) for (let d = 0; d < 3; d++) p[d] += prevRaw[i][d] / top.length
    for (let d = 0; d < 3; d++) p[d] += (rand() - 0.5) * 0.5
    return p
  }

  return {
    count: () => vectors.length,
    add: (v: Float32Array) => { vectors.push(v) },
    reset: () => { vectors = []; prevRaw = [] },

    fit(): Vec3[] {
      const n = vectors.length
      if (n > 0 && prevRaw.length === n) return prevRaw
      const data = vectors.map(v => Array.from(v))
      const warm = prevRaw.length > 0
      const rand = seededRandom(42)
      const umap = new UMAP({
        nComponents: 3,
        nNeighbors: Math.min(15, n - 1),
        minDist: 0.1,
        random: rand,
        distanceFn: umapDistanceFn(metric),
        ...(warm ? { nEpochs: warmEpochs, learningRate: warmLearningRate } : {}),
      })
      const nEpochs = umap.initializeFit(data)

      if (warm) {
        // Overwrite the random initial layout in place: the optimiser already holds
        // a reference to this array (umap-js has no public init option).
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const embedding = (umap as any).embedding as number[][]
        const placed = prevRaw.length
        for (let i = 0; i < n; i++) {
          const p = i < placed ? prevRaw[i] : seedPosition(vectors[i], placed, rand)
          for (let d = 0; d < 3; d++) embedding[i][d] = p[d]
        }
      }

      for (let e = 0; e < nEpochs; e++) umap.step()
      prevRaw = umap.getEmbedding().map(p => [p[0], p[1], p[2]] as Vec3)
      return prevRaw
    },
  }
}

export type LiveLayout = ReturnType<typeof createLiveLayout>

/**
 * View coordinates for a fit: rotated/reflected (Procrustes) onto `reference`,
 * the positions currently on screen for the points that have one, so the view
 * doesn't flip or spin; then re-centred and re-scaled so the cloud stays framed.
 * That last step is a pure zoom/shift, so it can't introduce flips or spins.
 */
export function alignToDisplayed(raw: Vec3[], reference: (Vec3 | undefined)[]): Vec3[] {
  const src: Vec3[] = []
  const tgt: Vec3[] = []
  reference.forEach((r, i) => { if (r) { src.push(raw[i]); tgt.push(r) } })
  return centreAndScale(src.length >= 3 ? applyTransform(raw, fitProcrustes(src, tgt)) : raw, LIVE_RMS_RADIUS)
}
