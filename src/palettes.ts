import * as THREE from 'three'

// Background for every 3D scene: black so the bright gradients (and bloom) read well.
export const SCENE_BG = new THREE.Color(0x000000)

// Shared along-the-transcript gradient (t = 0 at start, 1 at end).
export function glowPalette(t: number): THREE.Color {
  // Vivid blue → cyan → bright yellow — optimized for bloom glow
  const lut = [
    [0.10, 0.30, 1.00],  // t=0.00  vivid blue
    [0.00, 0.55, 1.00],  // t=0.25  dodger blue
    [0.00, 0.90, 0.95],  // t=0.50  cyan
    [0.60, 1.00, 0.20],  // t=0.75  yellow-green
    [1.00, 0.95, 0.05],  // t=1.00  bright yellow
  ]
  const scaled = Math.min(0.9999, Math.max(0, t)) * (lut.length - 1)
  const lo = Math.floor(scaled), hi = lo + 1
  const f = scaled - lo
  const [r, g, b] = lut[lo].map((v, i) => v + f * (lut[hi][i] - v))
  return new THREE.Color(r, g, b)
}

// Per-session gradients for the multi-session view (v9): start → end of each transcript.
const TRACK_LUTS: number[][][] = [
  [[0.10, 0.30, 1.00], [0.00, 0.70, 1.00], [0.30, 1.00, 0.95]], // A: blue → cyan → aqua
  [[0.85, 0.10, 0.75], [1.00, 0.35, 0.35], [1.00, 0.80, 0.10]], // B: magenta → coral → amber
  [[0.05, 0.55, 0.25], [0.30, 0.90, 0.35], [0.85, 1.00, 0.55]], // C: forest → green → pale lime
  [[0.40, 0.15, 0.95], [0.65, 0.45, 1.00], [1.00, 0.75, 0.95]], // D: violet → lavender → pink
]
export const TRACK_SWATCHES = ['#1ab2ff', '#ff5a5a', '#4cd964', '#a070ff']

export function trackPalette(track: number, t: number): THREE.Color {
  const lut = TRACK_LUTS[track % TRACK_LUTS.length]
  const scaled = Math.min(0.9999, Math.max(0, t)) * (lut.length - 1)
  const lo = Math.floor(scaled), hi = lo + 1
  const f = scaled - lo
  const [r, g, b] = lut[lo].map((v, i) => v + f * (lut[hi][i] - v))
  return new THREE.Color(r, g, b)
}
