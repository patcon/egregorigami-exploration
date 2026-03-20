import { UMAP } from 'umap-js'

export function runUmap(vectors: Float32Array[]): [number, number, number][] {
  const n = vectors.length
  const data = vectors.map(v => Array.from(v))
  const umap = new UMAP({
    nComponents: 3,
    nNeighbors: Math.min(15, n - 1),
    minDist: 0.1,
  })
  const result = umap.fit(data)
  return result as [number, number, number][]
}
