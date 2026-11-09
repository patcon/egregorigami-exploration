/** Distance metric UMAP uses to build its neighbour graph. */
export type UmapMetric = 'euclidean' | 'cosine'

export const UMAP_METRICS: { id: UmapMetric; label: string }[] = [
  { id: 'euclidean', label: 'Euclidean' },
  { id: 'cosine', label: 'Cosine' },
]

type Vector = number[]

function euclidean(a: Vector, b: Vector) {
  let s = 0
  for (let i = 0; i < a.length; i++) s += (a[i] - b[i]) ** 2
  return Math.sqrt(s)
}

function cosine(a: Vector, b: Vector) {
  let d = 0, na = 0, nb = 0
  for (let i = 0; i < a.length; i++) { d += a[i] * b[i]; na += a[i] ** 2; nb += b[i] ** 2 }
  return na && nb ? 1 - d / Math.sqrt(na * nb) : 1
}

export const umapDistanceFn = (metric: UmapMetric = 'cosine') => (metric === 'cosine' ? cosine : euclidean)
