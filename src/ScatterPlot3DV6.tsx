import { useEffect, useRef, useState } from 'react'
import * as THREE from 'three'
import { OrbitControls } from 'three/addons/controls/OrbitControls.js'
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js'
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js'
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js'
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js'
import type { CameraState, FollowMode } from './scatterTypes'

const BRANCH_HUES = [220, 30, 120, 280, 60, 180, 320, 150]

interface Props {
  points: [number, number, number][]
  labels: string[]
  highlightPosition: number | null
  onPointClick: (index: number) => void
  fillPerSeg?: number     // interpolated fill points per segment (default 12)
  fillJitter?: number     // random scatter radius around the line (default 0)
  fillBrightness?: number // brightness multiplier for fill particles (default 1)
  initialCameraState?: CameraState
  onCameraChange?: (state: CameraState) => void
  branchIds?: number[]
}

function normalize(points: [number, number, number][]): [number, number, number][] {
  const mins = [Infinity, Infinity, Infinity]
  const maxs = [-Infinity, -Infinity, -Infinity]
  for (const p of points) {
    for (let i = 0; i < 3; i++) {
      if (p[i] < mins[i]) mins[i] = p[i]
      if (p[i] > maxs[i]) maxs[i] = p[i]
    }
  }
  return points.map(p =>
    p.map((v, i) => {
      const range = maxs[i] - mins[i]
      return range === 0 ? 0 : ((v - mins[i]) / range) * 2 - 1
    }) as [number, number, number]
  )
}

function glowPalette(t: number): THREE.Color {
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

const vertexShader = /* glsl */`
attribute vec3 aColor;
attribute float aSeed;
varying vec3 vColor;
varying float vSeed;

void main() {
  vColor = aColor;
  vSeed = aSeed;
  vec4 mvPosition = modelViewMatrix * vec4(position, 1.0);
  // Size scales with camera distance; random seed adds per-point variation
  gl_PointSize = (1.5 + 2.5 / -mvPosition.z) * (0.6 + 0.8 * aSeed);
  gl_Position = projectionMatrix * mvPosition;
}
`

// Smaller variant for fill particles between nodes
const fillVertexShader = /* glsl */`
attribute vec3 aColor;
attribute float aSeed;
varying vec3 vColor;
varying float vSeed;

void main() {
  vColor = aColor;
  vSeed = aSeed;
  vec4 mvPosition = modelViewMatrix * vec4(position, 1.0);
  gl_PointSize = (0.7 + 1.2 / -mvPosition.z) * (0.4 + 0.6 * aSeed);
  gl_Position = projectionMatrix * mvPosition;
}
`

const fragmentShader = /* glsl */`
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

export default function ScatterPlot3DV6({ points, labels, highlightPosition, onPointClick, fillPerSeg = 12, fillJitter = 0.03, fillBrightness = 1.8, initialCameraState, onCameraChange, branchIds }: Props) {
  const mountRef = useRef<HTMLDivElement>(null)
  const sceneRef = useRef<{
    renderer: THREE.WebGLRenderer
    camera: THREE.PerspectiveCamera
    controls: OrbitControls
    scene: THREE.Scene
    pointsMesh: THREE.Points
    highlightMesh: THREE.Mesh
    raycaster: THREE.Raycaster
    animId: number
    composer: EffectComposer
    uniforms: { uTime: { value: number } }
  } | null>(null)
  const [tooltip, setTooltip] = useState<{ x: number; y: number; text: string } | null>(null)
  const [followMode, setFollowMode] = useState<FollowMode>(() => initialCameraState?.followMode ?? 'static')
  const followModeRef = useRef<FollowMode>(initialCameraState?.followMode ?? 'static')
  const prevFollowTargetRef = useRef(new THREE.Vector3())
  const prevPathTangentRef = useRef(new THREE.Vector3())
  const highlightPositionRef = useRef<number | null>(null)
  const targetSphereTRef = useRef(0)   // target float segment index
  const currentSphereTRef = useRef(0)  // animated segment index (lerps toward target)
  const sphereVisibleRef = useRef(false)
  const normalizedRef = useRef<[number, number, number][]>([])

  useEffect(() => {
    const mount = mountRef.current!
    let cleanup: (() => void) | undefined

    const init = () => {
      const w = mount.clientWidth
      const h = mount.clientHeight

      const renderer = new THREE.WebGLRenderer({ antialias: true })
      renderer.setSize(w, h)
      renderer.setPixelRatio(window.devicePixelRatio)
      renderer.toneMapping = THREE.ACESFilmicToneMapping
      renderer.toneMappingExposure = 1.0
      mount.appendChild(renderer.domElement)

      const scene = new THREE.Scene()
      scene.background = new THREE.Color(0x080b10)

      const camera = new THREE.PerspectiveCamera(60, w / h, 0.01, 100)
      camera.position.set(0, 0, 4)

      const controls = new OrbitControls(camera, renderer.domElement)
      controls.enableDamping = true
      controls.dampingFactor = 0.08

      if (initialCameraState) {
        camera.position.set(...initialCameraState.position)
        controls.target.set(...initialCameraState.target)
      }

      const onControlsChange = () => {
        onCameraChange?.({
          position: [camera.position.x, camera.position.y, camera.position.z],
          target: [controls.target.x, controls.target.y, controls.target.z],
          followMode: followModeRef.current,
        })
      }
      controls.addEventListener('change', onControlsChange)

      const normalized = normalize(points)
      normalizedRef.current = normalized
      const n = normalized.length

      const positions = new Float32Array(n * 3)
      const aColors = new Float32Array(n * 3)
      const aSeeds = new Float32Array(n)
      for (let i = 0; i < n; i++) {
        positions[i * 3] = normalized[i][0]
        positions[i * 3 + 1] = normalized[i][1]
        positions[i * 3 + 2] = normalized[i][2]
        let c: THREE.Color
        if (branchIds) {
          const hueIndex = branchIds[i] <= 1 ? 0 : branchIds[i] - 1
          c = new THREE.Color().setHSL(BRANCH_HUES[hueIndex % BRANCH_HUES.length] / 360, 1, 0.7)
        } else {
          c = glowPalette(i / (n - 1))
        }
        aColors[i * 3] = c.r
        aColors[i * 3 + 1] = c.g
        aColors[i * 3 + 2] = c.b
        aSeeds[i] = Math.random()
      }

      const geo = new THREE.BufferGeometry()
      geo.setAttribute('position', new THREE.BufferAttribute(positions, 3))
      geo.setAttribute('aColor', new THREE.BufferAttribute(aColors, 3))
      geo.setAttribute('aSeed', new THREE.BufferAttribute(aSeeds, 1))

      const uniforms = { uTime: { value: 0 }, uBrightness: { value: 1.0 } }
      const mat = new THREE.ShaderMaterial({
        uniforms,
        vertexShader,
        fragmentShader,
        transparent: true,
        depthWrite: false,
      })

      const pointsMesh = new THREE.Points(geo, mat)
      scene.add(pointsMesh)

      // Fill particles — interpolated between adjacent nodes with optional jitter.
      // With branchIds, only fill within each branch's own segments so particles
      // don't cross branch boundaries.
      type FillSegment = { from: number; to: number; color: THREE.Color | null }
      const fillSegments: FillSegment[] = []
      if (branchIds) {
        const numBranches = Math.max(...branchIds) + 1
        for (let bid = 0; bid < numBranches; bid++) {
          const branchOnly: number[] = []
          for (let i = 0; i < n; i++) if (branchIds[i] === bid) branchOnly.push(i)
          let indices: number[]
          if (bid === 0) {
            indices = branchOnly
          } else {
            const firstBranchIdx = branchOnly[0]
            let parentIdx = -1
            for (let i = firstBranchIdx - 1; i >= 0; i--) {
              if (branchIds[i] === 0) { parentIdx = i; break }
            }
            indices = parentIdx >= 0 ? [parentIdx, ...branchOnly] : branchOnly
          }
          const hueIndex = bid <= 1 ? 0 : bid - 1
          const branchColor = new THREE.Color().setHSL(BRANCH_HUES[hueIndex % BRANCH_HUES.length] / 360, 1, 0.7)
          for (let j = 0; j < indices.length - 1; j++) {
            fillSegments.push({ from: indices[j], to: indices[j + 1], color: branchColor })
          }
        }
      } else {
        for (let i = 0; i < n - 1; i++) fillSegments.push({ from: i, to: i + 1, color: null })
      }
      const fillCount = fillSegments.length * fillPerSeg
      const fillPositions = new Float32Array(fillCount * 3)
      const fillColors = new Float32Array(fillCount * 3)
      const fillSeeds = new Float32Array(fillCount)
      for (let si = 0; si < fillSegments.length; si++) {
        const { from, to, color } = fillSegments[si]
        for (let j = 0; j < fillPerSeg; j++) {
          const f = (j + 1) / (fillPerSeg + 1)
          const idx = si * fillPerSeg + j
          fillPositions[idx * 3]     = normalized[from][0] + (normalized[to][0] - normalized[from][0]) * f + (Math.random() - 0.5) * 2 * fillJitter
          fillPositions[idx * 3 + 1] = normalized[from][1] + (normalized[to][1] - normalized[from][1]) * f + (Math.random() - 0.5) * 2 * fillJitter
          fillPositions[idx * 3 + 2] = normalized[from][2] + (normalized[to][2] - normalized[from][2]) * f + (Math.random() - 0.5) * 2 * fillJitter
          const c = color ?? glowPalette((from + f) / (n - 1))
          fillColors[idx * 3] = c.r; fillColors[idx * 3 + 1] = c.g; fillColors[idx * 3 + 2] = c.b
          fillSeeds[idx] = Math.random()
        }
      }
      const fillGeo = new THREE.BufferGeometry()
      fillGeo.setAttribute('position', new THREE.BufferAttribute(fillPositions, 3))
      fillGeo.setAttribute('aColor',   new THREE.BufferAttribute(fillColors, 3))
      fillGeo.setAttribute('aSeed',    new THREE.BufferAttribute(fillSeeds, 1))
      // Share uTime with node material; use fillBrightness for fill-specific brightness
      const fillMat = new THREE.ShaderMaterial({
        uniforms: { uTime: uniforms.uTime, uBrightness: { value: fillBrightness } },
        vertexShader: fillVertexShader,
        fragmentShader,
        transparent: true,
        depthWrite: false,
      })
      const fillMesh = new THREE.Points(fillGeo, fillMat)
      scene.add(fillMesh)

      // Highlight sphere
      const hlGeo = new THREE.SphereGeometry(0.05, 16, 16)
      const hlMat = new THREE.MeshBasicMaterial({ color: 0xff3333 })
      const highlightMesh = new THREE.Mesh(hlGeo, hlMat)
      highlightMesh.visible = false
      scene.add(highlightMesh)

      // Post-processing: bloom
      const composer = new EffectComposer(renderer)
      composer.addPass(new RenderPass(scene, camera))
      const bloomPass = new UnrealBloomPass(new THREE.Vector2(w, h), 1.2, 0.5, 0.15)
      composer.addPass(bloomPass)
      composer.addPass(new OutputPass())

      const raycaster = new THREE.Raycaster()
      raycaster.params.Points!.threshold = 0.05

      let animId = 0
      let firstFrame = true
      const animate = () => {
        animId = requestAnimationFrame(animate)
        uniforms.uTime.value += 0.016
        // Lerp the segment index so the sphere travels along the piecewise-linear path.
        // On the first visible frame, snap to target and seed prevFollowTargetRef.
        if (sphereVisibleRef.current) {
          if (firstFrame) {
            currentSphereTRef.current = targetSphereTRef.current
            const ct = currentSphereTRef.current
            const norm = normalizedRef.current
            const a = Math.max(0, Math.floor(ct)), b = Math.min(norm.length - 1, Math.ceil(ct))
            const f = ct - a, pa = norm[a], pb = norm[b]
            highlightMesh.position.set(
              pa[0] + (pb[0] - pa[0]) * f,
              pa[1] + (pb[1] - pa[1]) * f,
              pa[2] + (pb[2] - pa[2]) * f,
            )
            prevFollowTargetRef.current.copy(highlightMesh.position)
            firstFrame = false
          } else {
            currentSphereTRef.current += (targetSphereTRef.current - currentSphereTRef.current) * 0.2
            const ct = currentSphereTRef.current
            const norm = normalizedRef.current
            const a = Math.max(0, Math.floor(ct)), b = Math.min(norm.length - 1, Math.ceil(ct))
            const f = ct - a, pa = norm[a], pb = norm[b]
            highlightMesh.position.set(
              pa[0] + (pb[0] - pa[0]) * f,
              pa[1] + (pb[1] - pa[1]) * f,
              pa[2] + (pb[2] - pa[2]) * f,
            )
          }
          highlightMesh.visible = true
        } else {
          firstFrame = false
          highlightMesh.visible = false
        }
        const mode = followModeRef.current
        if (mode === 'tracking' && highlightMesh.visible) {
          controls.enabled = true
          const newTarget = highlightMesh.position.clone()
          const delta = newTarget.clone().sub(prevFollowTargetRef.current)
          camera.position.add(delta)
          controls.target.copy(newTarget)
          prevFollowTargetRef.current.copy(newTarget)
          controls.update()
        } else if (mode === 'following' && highlightMesh.visible) {
          controls.enabled = true
          const newTarget = highlightMesh.position.clone()
          const norm = normalizedRef.current
          const hp = highlightPositionRef.current ?? 0
          const a = Math.max(0, Math.min(norm.length - 2, Math.floor(hp)))
          const currTangent = new THREE.Vector3(...norm[a + 1]).sub(new THREE.Vector3(...norm[a])).normalize()
          // Rotate camera's orbital offset to track path direction change
          const oldOffset = camera.position.clone().sub(prevFollowTargetRef.current)
          const prevTangent = prevPathTangentRef.current
          if (prevTangent.lengthSq() > 0) {
            const dot = prevTangent.dot(currTangent)
            if (dot < 0.9999 && dot > -0.9999) {
              oldOffset.applyQuaternion(new THREE.Quaternion().setFromUnitVectors(prevTangent, currTangent))
            }
          }
          camera.position.copy(newTarget).add(oldOffset)
          controls.target.copy(newTarget)
          prevFollowTargetRef.current.copy(newTarget)
          prevPathTangentRef.current.copy(currTangent)
          controls.update()
        } else {
          controls.enabled = true
          controls.update()
        }
        composer.render()
      }
      animate()

      const ro = new ResizeObserver(() => {
        const nw = mount.clientWidth
        const nh = mount.clientHeight
        renderer.setSize(nw, nh)
        composer.setSize(nw, nh)
        camera.aspect = nw / nh
        camera.updateProjectionMatrix()
      })
      ro.observe(mount)

      // Raycasting needs the raw renderer canvas for picking (composer renders to canvas)
      sceneRef.current = { renderer, camera, controls, scene, pointsMesh, highlightMesh, raycaster, animId, composer, uniforms }

      cleanup = () => {
        cancelAnimationFrame(animId)
        controls.removeEventListener('change', onControlsChange)
        controls.dispose()
        composer.dispose()
        renderer.dispose()
        ro.disconnect()
        fillGeo.dispose()
        fillMat.dispose()
        if (mount.contains(renderer.domElement)) mount.removeChild(renderer.domElement)
      }
    }

    if (mount.clientWidth > 0 && mount.clientHeight > 0) {
      init()
    } else {
      const ro = new ResizeObserver(() => {
        if (mount.clientWidth > 0 && mount.clientHeight > 0) {
          ro.disconnect()
          init()
        }
      })
      ro.observe(mount)
      cleanup = () => ro.disconnect()
    }

    return () => cleanup?.()
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [points, fillPerSeg, fillJitter, fillBrightness, branchIds])

  // Highlight updates — set target segment index; RAF lerps along the path each frame
  useEffect(() => {
    highlightPositionRef.current = highlightPosition
    const normalized = normalizedRef.current
    if (highlightPosition !== null && normalized.length > 0) {
      targetSphereTRef.current = Math.min(normalized.length - 1, Math.max(0, highlightPosition))
      sphereVisibleRef.current = true
    } else {
      sphereVisibleRef.current = false
    }
  }, [highlightPosition])

  const handleMouseMove = (e: React.MouseEvent<HTMLDivElement>) => {
    const s = sceneRef.current
    if (!s) return
    const rect = mountRef.current!.getBoundingClientRect()
    const mouse = new THREE.Vector2(
      ((e.clientX - rect.left) / rect.width) * 2 - 1,
      -((e.clientY - rect.top) / rect.height) * 2 + 1
    )
    s.raycaster.setFromCamera(mouse, s.camera)
    const hits = s.raycaster.intersectObject(s.pointsMesh)
    if (hits.length > 0) {
      setTooltip({ x: e.clientX - rect.left, y: e.clientY - rect.top, text: labels[hits[0].index!] })
    } else {
      setTooltip(null)
    }
  }

  const mouseDownRef = useRef<{ x: number; y: number } | null>(null)
  const handleMouseDown = (e: React.MouseEvent<HTMLDivElement>) => { mouseDownRef.current = { x: e.clientX, y: e.clientY } }
  const handleClick = (e: React.MouseEvent<HTMLDivElement>) => {
    const down = mouseDownRef.current
    if (!down) return
    const dx = e.clientX - down.x, dy = e.clientY - down.y
    if (dx * dx + dy * dy > 25) return
    const s = sceneRef.current
    if (!s) return
    const rect = mountRef.current!.getBoundingClientRect()
    const mouse = new THREE.Vector2(
      ((e.clientX - rect.left) / rect.width) * 2 - 1,
      -((e.clientY - rect.top) / rect.height) * 2 + 1
    )
    s.raycaster.setFromCamera(mouse, s.camera)
    const hits = s.raycaster.intersectObject(s.pointsMesh)
    if (hits.length > 0) onPointClick(hits[0].index!)
  }

  const followBtnClass = [
    'absolute bottom-2 left-2 text-[11px] py-[3px] px-2 cursor-pointer z-10 pointer-events-auto select-none transition-[background,color,border-color] duration-150 rounded border hover:bg-black/75 hover:text-white',
    followMode === 'tracking'
      ? 'bg-[rgba(40,100,200,0.35)] border-[rgba(80,140,255,0.6)] text-white'
      : followMode === 'following'
      ? 'bg-[rgba(200,50,50,0.35)] border-[rgba(255,80,80,0.6)] text-white'
      : 'bg-black/55 text-white/65 border-white/[0.18]',
  ].join(' ')

  return (
    <div className="relative w-full h-full min-h-0 cursor-crosshair [&_canvas]:block [&_canvas]:!w-full [&_canvas]:!h-full" ref={mountRef} onMouseMove={handleMouseMove} onMouseDown={handleMouseDown} onClick={handleClick}>
      {tooltip && (
        <div className="absolute pointer-events-none bg-black/80 text-white text-xs py-[5px] px-2 rounded max-w-[240px] whitespace-pre-wrap z-10 leading-[1.4]" style={{ left: tooltip.x + 12, top: tooltip.y + 12 }}>
          {tooltip.text}
        </div>
      )}
      <button
        className={followBtnClass}
        onClick={e => {
          e.stopPropagation()
          const modes: FollowMode[] = ['static', 'tracking', 'following']
          const next = modes[(modes.indexOf(followMode) + 1) % modes.length]
          setFollowMode(next)
          followModeRef.current = next
          const s = sceneRef.current
          if (s?.highlightMesh.visible) {
            if (next === 'tracking') {
              prevFollowTargetRef.current.copy(s.highlightMesh.position)
            } else if (next === 'following') {
              const norm = normalizedRef.current
              const hp = highlightPositionRef.current ?? 0
              const a = Math.max(0, Math.min(norm.length - 2, Math.floor(hp)))
              const tangent = new THREE.Vector3(...norm[a + 1]).sub(new THREE.Vector3(...norm[a])).normalize()
              const cursorPos = s.highlightMesh.position.clone()
              s.camera.position.copy(cursorPos).addScaledVector(tangent, -0.6).add(new THREE.Vector3(0, 0.15, 0))
              s.controls.target.copy(cursorPos)
              prevFollowTargetRef.current.copy(cursorPos)
              prevPathTangentRef.current.copy(tangent)
            }
          }
          if (s) {
            onCameraChange?.({
              position: [s.camera.position.x, s.camera.position.y, s.camera.position.z],
              target: [s.controls.target.x, s.controls.target.y, s.controls.target.z],
              followMode: next,
            })
          }
        }}
      >
        {followMode === 'static' ? '◎ Static' : followMode === 'tracking' ? '◉ Tracking' : '⬤ Following'}
      </button>
    </div>
  )
}
