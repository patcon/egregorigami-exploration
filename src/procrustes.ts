import { Matrix, SingularValueDecomposition } from 'ml-matrix'

export type Vec3 = [number, number, number]

/**
 * Similarity transform (rotation/reflection + uniform scale + translation)
 * that maps `source` points onto `target` points: target ≈ s · source · R + t.
 */
export interface SimilarityTransform {
  rotation: number[][]   // 3×3, applied to row vectors (p · R)
  scale: number
  sourceCentroid: Vec3
  targetCentroid: Vec3
}

function centroid(points: Vec3[]): Vec3 {
  const c: Vec3 = [0, 0, 0]
  for (const p of points) { c[0] += p[0]; c[1] += p[1]; c[2] += p[2] }
  const n = Math.max(1, points.length)
  return [c[0] / n, c[1] / n, c[2] / n]
}

/**
 * Orthogonal Procrustes with scaling. Finds the best-fit (least squares)
 * transform taking `source[i]` to `target[i]` for every i in the shorter list.
 *
 * Reflections are deliberately allowed (no det(R) = +1 correction). Mirror
 * flips between UMAP runs are exactly what we want to undo, so a reflection
 * that best matches the previous frame is the right answer here.
 */
export function fitProcrustes(source: Vec3[], target: Vec3[]): SimilarityTransform {
  const n = Math.min(source.length, target.length)
  const src = source.slice(0, n)
  const tgt = target.slice(0, n)
  const cs = centroid(src)
  const ct = centroid(tgt)
  const A = new Matrix(src.map(p => [p[0] - cs[0], p[1] - cs[1], p[2] - cs[2]]))
  const B = new Matrix(tgt.map(p => [p[0] - ct[0], p[1] - ct[1], p[2] - ct[2]]))

  // M = Aᵀ B = U Σ Vᵀ  →  R = U Vᵀ minimises ‖A R − B‖
  const svd = new SingularValueDecomposition(A.transpose().mmul(B))
  const R = svd.leftSingularVectors.mmul(svd.rightSingularVectors.transpose())
  const traceSigma = svd.diagonal.reduce((a, b) => a + b, 0)
  const normA = A.to1DArray().reduce((acc, v) => acc + v * v, 0)
  const scale = normA > 0 ? traceSigma / normA : 1

  return { rotation: R.to2DArray(), scale, sourceCentroid: cs, targetCentroid: ct }
}

export function applyTransform(points: Vec3[], t: SimilarityTransform): Vec3[] {
  const R = t.rotation
  const [cx, cy, cz] = t.sourceCentroid
  return points.map(p => {
    const x = p[0] - cx, y = p[1] - cy, z = p[2] - cz
    return [
      t.scale * (x * R[0][0] + y * R[1][0] + z * R[2][0]) + t.targetCentroid[0],
      t.scale * (x * R[0][1] + y * R[1][1] + z * R[2][1]) + t.targetCentroid[1],
      t.scale * (x * R[0][2] + y * R[1][2] + z * R[2][2]) + t.targetCentroid[2],
    ]
  })
}

/** Centre a point set at the origin and scale it to the given RMS radius. */
export function centreAndScale(points: Vec3[], rmsRadius: number): Vec3[] {
  const c = centroid(points)
  const centred = points.map(p => [p[0] - c[0], p[1] - c[1], p[2] - c[2]] as Vec3)
  const rms = Math.sqrt(centred.reduce((acc, p) => acc + p[0] ** 2 + p[1] ** 2 + p[2] ** 2, 0) / Math.max(1, centred.length))
  const s = rms > 0 ? rmsRadius / rms : 1
  return centred.map(p => [p[0] * s, p[1] * s, p[2] * s])
}
