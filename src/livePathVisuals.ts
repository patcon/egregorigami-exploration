import * as THREE from 'three'
import { Line2 } from 'three/addons/lines/Line2.js'
import { LineGeometry } from 'three/addons/lines/LineGeometry.js'
import { LineMaterial } from 'three/addons/lines/LineMaterial.js'
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js'
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js'
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js'
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js'

/**
 * Path styles for the live renderers (ScatterPlot3DLive, ScatterPlot3DMulti).
 * Same ids as the static renderers' selector, so one setting drives both:
 * 'original' = thick line, 'cividis-tube' = shaded tube, 'glow' = bloom particles.
 *
 * Unlike the static renderers, these rebuild from the live buffers whenever
 * points move, so they follow the tween as the layout evolves.
 */
export type LiveRenderer = 'original' | 'cividis-tube' | 'glow'

/** Line width (px) at which the tube/fill sizes match the static renderers. */
const REF_LINE_WIDTH = 3
/** Node size (world units) at which glow node sprites match the static renderer. */
const REF_NODE_SIZE = 0.04

const TUBE_RADIUS = 0.025
const TUBE_RADIAL_SEGMENTS = 10
/** Caps tube rebuild cost on long transcripts (it's rebuilt every frame while tweening). */
const MAX_TUBE_RINGS = 4000

const FILL_PER_SEG = 20
const FILL_JITTER = 0.03
const FILL_BRIGHTNESS = 1.8

const BLOOM_REFERENCE_POINTS = 150
const MIN_DENSITY_SCALE = 0.25

/** Stable pseudo-random in [0, 1) so fill particles don't shimmer when the path is rebuilt. */
export function hash01(n: number): number {
  const x = Math.sin(n * 12.9898 + 78.233) * 43758.5453
  return x - Math.floor(x)
}

export interface PathEmphasis {
  /** Opacity of the thick line ('original'). */
  lineOpacity: number
  /** De-emphasise (other sessions in v9): see-through tube, dimmer glow. */
  dimmed: boolean
  renderOrder: number
}

export interface PathVisual {
  /**
   * Rebuild from the displayed (possibly mid-tween) path: `pos`/`col` hold at
   * least `m` xyz/rgb triples in path order. Not retained.
   */
  update(pos: Float32Array, col: Float32Array, m: number): void
  /** Point on the drawn path at fractional node index t, if it isn't straight segments. */
  pointAt(t: number, out: THREE.Vector3): THREE.Vector3 | null
  setLineWidth(px: number): void
  setEmphasis(e: PathEmphasis): void
  dispose(): void
}

export function createPathVisual(style: LiveRenderer, scene: THREE.Scene, lineWidth: number, glow: GlowFx | null): PathVisual {
  if (style === 'cividis-tube') return tubeVisual(scene, lineWidth)
  if (style === 'glow' && glow) return glowFillVisual(scene, glow)
  return lineVisual(scene, lineWidth)
}

/** Lights for the tube's MeshStandardMaterial (no effect on the other styles' materials). */
export function addTubeLights(scene: THREE.Scene) {
  scene.add(new THREE.AmbientLight(0xffffff, 0.7))
  scene.add(new THREE.DirectionalLight(0xffffff, 0.8))
}

// ─── Thick line ────────────────────────────────────────────────────────────

function lineVisual(scene: THREE.Scene, lineWidth: number): PathVisual {
  const mat = new LineMaterial({ vertexColors: true, linewidth: lineWidth, opacity: 0.6, transparent: true, depthWrite: false })
  const mesh = new Line2(new LineGeometry(), mat)
  mesh.visible = false
  mesh.frustumCulled = false
  scene.add(mesh)
  return {
    update(pos, col, m) {
      // Line2 is screen-space (real pixel widths) but can't share the points' buffer
      mesh.visible = m >= 2
      if (m < 2) return
      const geo = new LineGeometry()
      geo.setPositions(pos.subarray(0, m * 3))
      geo.setColors(col.subarray(0, m * 3))
      mesh.geometry.dispose()
      mesh.geometry = geo
    },
    pointAt: () => null,
    setLineWidth(px) { mat.linewidth = px },
    setEmphasis({ lineOpacity, renderOrder }) { mat.opacity = lineOpacity; mesh.renderOrder = renderOrder },
    dispose() { scene.remove(mesh); mesh.geometry.dispose(); mat.dispose() },
  }
}

// ─── Tube ──────────────────────────────────────────────────────────────────

/**
 * Catmull-Rom curve sampled by node index rather than arc length, so tube
 * rings line up with nodes (each node-to-node segment gets the same number of
 * rings) and t = i / (m - 1) lands exactly on node i.
 */
class NodeCurve extends THREE.CatmullRomCurve3 {
  getPointAt(u: number, target?: THREE.Vector3) { return this.getPoint(u, target) }
  getTangentAt(u: number, target?: THREE.Vector3) { return this.getTangent(u, target) }
}

function tubeVisual(scene: THREE.Scene, lineWidth: number): PathVisual {
  const mat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.6, metalness: 0.1 })
  const mesh = new THREE.Mesh(new THREE.BufferGeometry(), mat)
  mesh.visible = false
  mesh.frustumCulled = false
  scene.add(mesh)
  let radius = TUBE_RADIUS * lineWidth / REF_LINE_WIDTH
  let curve: NodeCurve | null = null
  let colors = new Float32Array(0)

  const rebuild = () => {
    mesh.visible = curve !== null
    if (!curve) return
    const m = curve.points.length
    const perSeg = Math.max(2, Math.min(6, Math.floor(MAX_TUBE_RINGS / (m - 1))))
    const segs = (m - 1) * perSeg
    const geo = new THREE.TubeGeometry(curve, segs, radius, TUBE_RADIAL_SEGMENTS, false)
    const vertsPerRing = TUBE_RADIAL_SEGMENTS + 1
    const out = new Float32Array(geo.attributes.position.count * 3)
    for (let ring = 0; ring <= segs; ring++) {
      const a = Math.min(m - 2, Math.floor(ring / perSeg))
      const f = ring / perSeg - a
      // Alternate brightness between node-to-node segments to show spacing
      const bright = a % 2 === 0 ? 1.2 : 0.7
      const r = Math.min(1, (colors[a * 3] + (colors[a * 3 + 3] - colors[a * 3]) * f) * bright)
      const g = Math.min(1, (colors[a * 3 + 1] + (colors[a * 3 + 4] - colors[a * 3 + 1]) * f) * bright)
      const b = Math.min(1, (colors[a * 3 + 2] + (colors[a * 3 + 5] - colors[a * 3 + 2]) * f) * bright)
      for (let v = ring * vertsPerRing; v < (ring + 1) * vertsPerRing; v++) {
        out[v * 3] = r; out[v * 3 + 1] = g; out[v * 3 + 2] = b
      }
    }
    geo.setAttribute('color', new THREE.BufferAttribute(out, 3))
    mesh.geometry.dispose()
    mesh.geometry = geo
  }

  return {
    update(pos, col, m) {
      if (m < 2) { curve = null; rebuild(); return }
      const pts: THREE.Vector3[] = []
      for (let i = 0; i < m; i++) pts.push(new THREE.Vector3(pos[i * 3], pos[i * 3 + 1], pos[i * 3 + 2]))
      // Centripetal so the curve never overshoots or loops between far-apart nodes
      curve = new NodeCurve(pts, false, 'centripetal')
      colors = col.slice(0, m * 3)
      rebuild()
    },
    pointAt(t, out) {
      if (!curve) return null
      const m = curve.points.length
      return curve.getPoint(Math.max(0, Math.min(1, t / (m - 1))), out)
    },
    setLineWidth(px) {
      radius = TUBE_RADIUS * px / REF_LINE_WIDTH
      rebuild()
    },
    setEmphasis({ dimmed, renderOrder }) {
      mat.transparent = dimmed
      mat.opacity = dimmed ? 0.35 : 1
      mat.depthWrite = !dimmed
      mat.needsUpdate = true
      mesh.renderOrder = renderOrder
    },
    dispose() { scene.remove(mesh); mesh.geometry.dispose(); mat.dispose() },
  }
}

// ─── Glow ──────────────────────────────────────────────────────────────────

const nodeVertexShader = /* glsl */`
attribute vec3 aColor;
attribute float aSeed;
uniform float uScale;
uniform float uSize;
varying vec3 vColor;
varying float vSeed;

void main() {
  vColor = aColor;
  vSeed = aSeed;
  vec4 mvPosition = modelViewMatrix * vec4(position, 1.0);
  // Size scales with camera distance, canvas size (uScale), and random seed variation
  gl_PointSize = (2.5 + 5.0 / -mvPosition.z) * (0.6 + 0.8 * aSeed) * uScale * uSize;
  gl_Position = projectionMatrix * mvPosition;
}
`

// Smaller variant for fill particles between nodes
const fillVertexShader = /* glsl */`
attribute vec3 aColor;
attribute float aSeed;
uniform float uScale;
uniform float uSize;
varying vec3 vColor;
varying float vSeed;

void main() {
  vColor = aColor;
  vSeed = aSeed;
  vec4 mvPosition = modelViewMatrix * vec4(position, 1.0);
  gl_PointSize = (1.2 + 2.5 / -mvPosition.z) * (0.4 + 0.6 * aSeed) * uScale * uSize;
  gl_Position = projectionMatrix * mvPosition;
}
`

const glowFragmentShader = /* glsl */`
varying vec3 vColor;
varying float vSeed;
uniform float uTime;
uniform float uBrightness;

void main() {
  vec2 uv = gl_PointCoord - 0.5;
  float d = length(uv);
  if (d > 0.5) discard;
  float alpha = 1.0 - smoothstep(0.25, 0.5, d);
  // Each point pulses at its own phase, derived from its random seed
  float pulse = 0.65 + 0.35 * sin(vSeed * 50.0 + uTime * 2.5);
  gl_FragColor = vec4(vColor * pulse * uBrightness, alpha);
}
`

/**
 * Bloom post-processing plus the shared shader uniforms for the 'glow' style.
 * Node sprites use `nodeMaterial` on the renderer's existing points mesh, which
 * needs `aColor` and `aSeed` attributes alongside `position`.
 */
export interface GlowFx {
  nodeMaterial: THREE.ShaderMaterial
  uniforms: { uTime: { value: number }; uScale: { value: number }; uFillSize: { value: number } }
  setNodeSize(nodeSize: number): void
  setLineWidth(px: number): void
  setSize(w: number, h: number): void
  /** Render through bloom. `nodeCount` thins the bloom as the path gets denser. */
  render(dt: number, camDist: number, nodeCount: number, strength: number): void
  dispose(): void
}

export function createGlowFx(renderer: THREE.WebGLRenderer, scene: THREE.Scene, camera: THREE.Camera, w: number, h: number, nodeSize: number, lineWidth: number): GlowFx {
  renderer.toneMapping = THREE.ACESFilmicToneMapping
  renderer.toneMappingExposure = 1.0
  const uniforms = {
    uTime: { value: 0 },
    uScale: { value: Math.max(1, h / 500) },
    uFillSize: { value: lineWidth / REF_LINE_WIDTH },
  }
  const nodeMaterial = new THREE.ShaderMaterial({
    uniforms: { uTime: uniforms.uTime, uScale: uniforms.uScale, uSize: { value: nodeSize / REF_NODE_SIZE }, uBrightness: { value: 1 } },
    vertexShader: nodeVertexShader,
    fragmentShader: glowFragmentShader,
    transparent: true,
    depthWrite: false,
  })
  const composer = new EffectComposer(renderer)
  composer.addPass(new RenderPass(scene, camera))
  const bloomPass = new UnrealBloomPass(new THREE.Vector2(w, h), 1.5, 0.6, 0.10)
  composer.addPass(bloomPass)
  composer.addPass(new OutputPass())

  return {
    nodeMaterial,
    uniforms,
    setNodeSize(size) { nodeMaterial.uniforms.uSize.value = size / REF_NODE_SIZE },
    setLineWidth(px) { uniforms.uFillSize.value = px / REF_LINE_WIDTH },
    setSize(nw, nh) {
      composer.setSize(nw, nh)
      // Scale particle sizes with canvas height so they stay visually consistent
      uniforms.uScale.value = Math.max(1, nh / 500)
    },
    render(dt, camDist, nodeCount, strength) {
      uniforms.uTime.value += dt
      // More points pack more bright pixels into the same space, so bloom piles up; thin it out
      const density = Math.min(1, Math.max(MIN_DENSITY_SCALE, Math.sqrt(BLOOM_REFERENCE_POINTS / Math.max(1, nodeCount))))
      // Farther away = weaker glow per pixel, so compensate as the camera zooms out
      bloomPass.strength = Math.max(1.0, 1.5 * (camDist / 4.0)) * strength * density
      bloomPass.radius = Math.min(1.0, 0.5 + 0.08 * (camDist / 4.0)) * strength
      composer.render()
    },
    dispose() { composer.dispose(); nodeMaterial.dispose() },
  }
}

/** Glowing particles scattered along each node-to-node segment. */
function glowFillVisual(scene: THREE.Scene, glow: GlowFx): PathVisual {
  const brightness = { value: FILL_BRIGHTNESS }
  const mat = new THREE.ShaderMaterial({
    uniforms: { uTime: glow.uniforms.uTime, uScale: glow.uniforms.uScale, uSize: glow.uniforms.uFillSize, uBrightness: brightness },
    vertexShader: fillVertexShader,
    fragmentShader: glowFragmentShader,
    transparent: true,
    depthWrite: false,
  })
  const geo = new THREE.BufferGeometry()
  const mesh = new THREE.Points(geo, mat)
  mesh.frustumCulled = false
  scene.add(mesh)
  let capacity = 0
  let position = new THREE.BufferAttribute(new Float32Array(0), 3)
  let color = new THREE.BufferAttribute(new Float32Array(0), 3)

  const ensure = (count: number) => {
    if (count <= capacity) return
    let cap = Math.max(256, capacity)
    while (cap < count) cap *= 2
    position = new THREE.BufferAttribute(new Float32Array(cap * 3), 3).setUsage(THREE.DynamicDrawUsage)
    color = new THREE.BufferAttribute(new Float32Array(cap * 3), 3).setUsage(THREE.DynamicDrawUsage)
    const seeds = new Float32Array(cap)
    for (let i = 0; i < cap; i++) seeds[i] = hash01(i * 4 + 3)
    geo.setAttribute('position', position)
    geo.setAttribute('aColor', color)
    geo.setAttribute('aSeed', new THREE.BufferAttribute(seeds, 1))
    capacity = cap
  }

  return {
    update(pos, col, m) {
      const count = Math.max(0, m - 1) * FILL_PER_SEG
      ensure(count)
      const p = position.array as Float32Array
      const c = color.array as Float32Array
      for (let s = 0; s < m - 1; s++) {
        for (let j = 0; j < FILL_PER_SEG; j++) {
          const f = (j + 1) / (FILL_PER_SEG + 1)
          const gi = s * FILL_PER_SEG + j
          for (let d = 0; d < 3; d++) {
            const a = s * 3 + d, b = a + 3
            p[gi * 3 + d] = pos[a] + (pos[b] - pos[a]) * f + (hash01(gi * 4 + d) - 0.5) * 2 * FILL_JITTER
            c[gi * 3 + d] = col[a] + (col[b] - col[a]) * f
          }
        }
      }
      position.needsUpdate = true
      color.needsUpdate = true
      geo.setDrawRange(0, count)
    },
    pointAt: () => null,
    setLineWidth() { /* fill size follows the shared uFillSize uniform */ },
    setEmphasis({ dimmed, renderOrder }) {
      brightness.value = dimmed ? FILL_BRIGHTNESS * 0.45 : FILL_BRIGHTNESS
      mesh.renderOrder = renderOrder
    },
    dispose() { scene.remove(mesh); geo.dispose(); mat.dispose() },
  }
}
