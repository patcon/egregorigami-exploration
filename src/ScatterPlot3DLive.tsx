import { useEffect, useRef, useState } from 'react'
import * as THREE from 'three'
import { OrbitControls } from 'three/addons/controls/OrbitControls.js'
import { glowPalette, SCENE_BG } from './palettes'
import { addTubeLights, createGlowFx, createPathVisual, hash01, type GlowFx, type LiveRenderer, type PathVisual } from './livePathVisuals'
import { swingFollowCamera } from './followCamera'
import type { CameraState, FollowMode } from './scatterTypes'

interface Props {
  /** Already aligned to the previous frame and in display units — not re-normalised here. */
  points: [number, number, number][]
  labels: string[]
  highlightPosition: number | null  // float: 1.7 = 70% between node 1 and 2
  onPointClick: (index: number) => void
  initialCameraState?: CameraState
  onCameraChange?: (state: CameraState) => void
  /** Path line width in screen pixels. */
  lineWidth?: number
  /** Node (point) size in world units. */
  nodeSize?: number
  /** Slowly orbit the camera around its target (the cloud's centre unless panned). */
  autoRotate?: boolean
  /** Orbit speed; 1 ≈ one revolution per minute. */
  autoRotateSpeed?: number
  /** Fixed floor grid under the cloud, as a stable reference while points move. */
  showGrid?: boolean
  /** Path style. Read once when the scene is built: remount (e.g. via `key`) to change it. */
  renderer?: LiveRenderer
  /** Bloom intensity multiplier ('glow' only). */
  glowStrength?: number
}

export const DEFAULT_LINE_WIDTH = 3
export const DEFAULT_NODE_SIZE = 0.04

const TWEEN_MS = 900
// The live layout is centred on the origin with RMS radius ~0.9 (see liveLayout.ts)
const GRID_SIZE = 6
const GRID_DIVISIONS = 24
const GRID_Y = -1.2
const easeInOutCubic = (t: number) => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2)

/** Mutable buffers shared by the points and the path line. Grown by doubling. */
interface Buffers {
  capacity: number
  position: THREE.BufferAttribute
  color: THREE.BufferAttribute
  /** Per-point random in [0, 1): glow sprite size and pulse phase. */
  seed: THREE.BufferAttribute
  fromPos: Float32Array
  toPos: Float32Array
  fromCol: Float32Array
  toCol: Float32Array
}

function makeBuffers(capacity: number): Buffers {
  return {
    capacity,
    position: new THREE.BufferAttribute(new Float32Array(capacity * 3), 3).setUsage(THREE.DynamicDrawUsage),
    color: new THREE.BufferAttribute(new Float32Array(capacity * 3), 3).setUsage(THREE.DynamicDrawUsage),
    seed: new THREE.BufferAttribute(Float32Array.from({ length: capacity }, (_, i) => hash01(i)), 1),
    fromPos: new Float32Array(capacity * 3),
    toPos: new Float32Array(capacity * 3),
    fromCol: new Float32Array(capacity * 3),
    toCol: new Float32Array(capacity * 3),
  }
}

/** Point the geometry at the buffers (the glow shader reads colours as `aColor`). */
function bindBuffers(geo: THREE.BufferGeometry, buf: Buffers) {
  geo.setAttribute('position', buf.position)
  geo.setAttribute('color', buf.color)
  geo.setAttribute('aColor', buf.color)
  geo.setAttribute('aSeed', buf.seed)
}

/**
 * Renderer for the live (incremental) view. Unlike the static renderers, the
 * scene is built once and point updates tween in place, so the camera and
 * frame of reference stay put while the layout evolves. The path is drawn as
 * a line, tube or glow (see livePathVisuals.ts).
 */
export default function ScatterPlot3DLive({ points, labels, highlightPosition, onPointClick, initialCameraState, onCameraChange, lineWidth = DEFAULT_LINE_WIDTH, nodeSize = DEFAULT_NODE_SIZE, autoRotate = false, autoRotateSpeed = 1, showGrid = true, renderer: rendererStyle = 'original', glowStrength = 1 }: Props) {
  const mountRef = useRef<HTMLDivElement>(null)
  const sceneRef = useRef<{
    camera: THREE.PerspectiveCamera
    controls: OrbitControls
    pointsMesh: THREE.Points
    pointsMat: THREE.PointsMaterial
    path: PathVisual
    glow: GlowFx | null
    highlightMesh: THREE.Mesh
    grid: THREE.GridHelper
    raycaster: THREE.Raycaster
    bgColor: THREE.Color
  } | null>(null)
  const buffersRef = useRef<Buffers>(makeBuffers(64))
  const countRef = useRef(0)
  const tweenStartRef = useRef<number | null>(null)
  const pendingPointsRef = useRef<[number, number, number][] | null>(points)

  const [tooltip, setTooltip] = useState<{ x: number; y: number; text: string } | null>(null)
  const [followMode, setFollowMode] = useState<FollowMode>(() => initialCameraState?.followMode ?? 'static')
  const followModeRef = useRef<FollowMode>(initialCameraState?.followMode ?? 'static')
  const prevFollowTargetRef = useRef(new THREE.Vector3())
  const prevPathTangentRef = useRef(new THREE.Vector3())
  const highlightPositionRef = useRef<number | null>(highlightPosition)
  const currentSphereTRef = useRef(0)
  const styleRef = useRef({ lineWidth, nodeSize, autoRotate, autoRotateSpeed, showGrid })
  const glowStrengthRef = useRef(glowStrength)
  useEffect(() => { glowStrengthRef.current = glowStrength }, [glowStrength])
  const labelsRef = useRef(labels)
  useEffect(() => { labelsRef.current = labels }, [labels])
  const onCameraChangeRef = useRef(onCameraChange)
  useEffect(() => { onCameraChangeRef.current = onCameraChange }, [onCameraChange])

  /** Displayed position of point i (mid-tween values included). */
  const pointAt = (i: number, out: THREE.Vector3) => {
    const arr = buffersRef.current.position.array as Float32Array
    return out.set(arr[i * 3], arr[i * 3 + 1], arr[i * 3 + 2])
  }

  /** Displayed position at a fractional index along the path (on the tube's curve, if drawn). */
  const pathAt = (t: number, out: THREE.Vector3) => {
    const n = countRef.current
    const ct = Math.max(0, Math.min(n - 1, t))
    if (n >= 2 && sceneRef.current?.path.pointAt(ct, out)) return out
    const a = Math.floor(ct), b = Math.min(n - 1, a + 1)
    const pa = pointAt(a, new THREE.Vector3())
    const pb = pointAt(b, new THREE.Vector3())
    return out.copy(pa).lerp(pb, ct - a)
  }

  const pathTangentAt = (t: number) => {
    const n = countRef.current
    const a = Math.max(0, Math.min(n - 2, Math.floor(t)))
    return pointAt(a + 1, new THREE.Vector3()).sub(pointAt(a, new THREE.Vector3())).normalize()
  }

  /** Rebuild the path from the displayed positions/colours; called while points are moving. */
  const syncLine = () => {
    const s = sceneRef.current
    if (!s) return
    const b = buffersRef.current
    s.path.update(b.position.array as Float32Array, b.color.array as Float32Array, countRef.current)
  }

  /** Start tweening from what's on screen now to `next`. */
  const retarget = (next: [number, number, number][]) => {
    const s = sceneRef.current
    if (!s) { pendingPointsRef.current = next; return }
    const n = next.length
    let buf = buffersRef.current
    if (n > buf.capacity) {
      let cap = buf.capacity
      while (cap < n) cap *= 2
      const grown = makeBuffers(cap)
      ;(grown.position.array as Float32Array).set(buf.position.array as Float32Array)
      ;(grown.color.array as Float32Array).set(buf.color.array as Float32Array)
      bindBuffers(s.pointsMesh.geometry, grown)
      buffersRef.current = buf = grown
    }
    const prevN = countRef.current
    const pos = buf.position.array as Float32Array
    const col = buf.color.array as Float32Array
    buf.fromPos.set(pos.subarray(0, n * 3))
    buf.fromCol.set(col.subarray(0, n * 3))
    for (let i = 0; i < n; i++) {
      const c = glowPalette(n > 1 ? i / (n - 1) : 0)
      buf.toPos[i * 3] = next[i][0]; buf.toPos[i * 3 + 1] = next[i][1]; buf.toPos[i * 3 + 2] = next[i][2]
      buf.toCol[i * 3] = c.r; buf.toCol[i * 3 + 1] = c.g; buf.toCol[i * 3 + 2] = c.b
      if (i >= prevN) {
        // New points appear in place and fade in from the background colour
        buf.fromPos[i * 3] = next[i][0]; buf.fromPos[i * 3 + 1] = next[i][1]; buf.fromPos[i * 3 + 2] = next[i][2]
        buf.fromCol[i * 3] = s.bgColor.r; buf.fromCol[i * 3 + 1] = s.bgColor.g; buf.fromCol[i * 3 + 2] = s.bgColor.b
      }
    }
    countRef.current = n
    s.pointsMesh.geometry.setDrawRange(0, n)
    syncLine()
    tweenStartRef.current = performance.now()
  }

  // Build the scene once
  useEffect(() => {
    const mount = mountRef.current!
    let cleanup: (() => void) | undefined

    const init = () => {
      const w = mount.clientWidth
      const h = mount.clientHeight

      const renderer = new THREE.WebGLRenderer({ antialias: true })
      renderer.setSize(w, h)
      renderer.setPixelRatio(window.devicePixelRatio)
      const bgColor = SCENE_BG
      renderer.setClearColor(bgColor)
      mount.appendChild(renderer.domElement)

      const scene = new THREE.Scene()
      const camera = new THREE.PerspectiveCamera(60, w / h, 0.01, 100)
      camera.position.set(0, 0, 3)

      const controls = new OrbitControls(camera, renderer.domElement)
      controls.enableDamping = true
      controls.dampingFactor = 0.08
      // OrbitControls' autoRotateSpeed 2 = 30s per orbit at 60fps, so speed 1 here ≈ 60s per orbit
      controls.autoRotate = styleRef.current.autoRotate
      controls.autoRotateSpeed = styleRef.current.autoRotateSpeed
      if (initialCameraState) {
        camera.position.set(...initialCameraState.position)
        controls.target.set(...initialCameraState.target)
      }
      const onControlsChange = () => {
        onCameraChangeRef.current?.({
          position: [camera.position.x, camera.position.y, camera.position.z],
          target: [controls.target.x, controls.target.y, controls.target.z],
          followMode: followModeRef.current,
        })
      }
      controls.addEventListener('change', onControlsChange)

      const glow = rendererStyle === 'glow'
        ? createGlowFx(renderer, scene, camera, w, h, styleRef.current.nodeSize, styleRef.current.lineWidth)
        : null
      if (rendererStyle === 'cividis-tube') addTubeLights(scene)

      const pointsGeo = new THREE.BufferGeometry()
      bindBuffers(pointsGeo, buffersRef.current)
      pointsGeo.setDrawRange(0, 0)
      const pointsMat = new THREE.PointsMaterial({ size: styleRef.current.nodeSize, sizeAttenuation: true, vertexColors: true })
      const pointsMesh = new THREE.Points(pointsGeo, glow ? glow.nodeMaterial : pointsMat)
      pointsMesh.frustumCulled = false
      // The tube's alternating shading marks the nodes; keep the (hidden) points for hover/click
      pointsMesh.visible = rendererStyle !== 'cividis-tube'
      scene.add(pointsMesh)

      const path = createPathVisual(rendererStyle, scene, styleRef.current.lineWidth, glow)
      path.setEmphasis({ lineOpacity: 0.6, dimmed: false, renderOrder: 0 })

      const highlightMesh = new THREE.Mesh(new THREE.SphereGeometry(0.04, 16, 16), new THREE.MeshBasicMaterial({ color: 0xff2222 }))
      highlightMesh.visible = false
      highlightMesh.scale.setScalar(Math.max(1, styleRef.current.nodeSize / DEFAULT_NODE_SIZE))
      scene.add(highlightMesh)

      // World-fixed (not tied to the cloud), so it stays put while points re-layout
      const grid = new THREE.GridHelper(GRID_SIZE, GRID_DIVISIONS, 0x8a8a8a, 0x4a4a4a)
      grid.position.y = GRID_Y
      const gridMat = grid.material as THREE.LineBasicMaterial
      gridMat.transparent = true
      gridMat.opacity = 1
      gridMat.depthWrite = false
      grid.visible = styleRef.current.showGrid
      scene.add(grid)

      const raycaster = new THREE.Raycaster()
      raycaster.params.Points!.threshold = 0.05

      sceneRef.current = { camera, controls, pointsMesh, pointsMat, path, glow, highlightMesh, grid, raycaster, bgColor }
      if (pendingPointsRef.current) { retarget(pendingPointsRef.current); pendingPointsRef.current = null }
      else { pointsGeo.setDrawRange(0, countRef.current); syncLine() } // rebuilt scene (StrictMode remount)

      let animId = 0
      let sphereWasVisible = false
      let lastFrame = performance.now()
      const animate = () => {
        animId = requestAnimationFrame(animate)
        const now = performance.now()
        const dt = Math.min(0.1, (now - lastFrame) / 1000) // seconds; clamp after tab switches
        lastFrame = now
        const n = countRef.current

        // Position/colour tween
        if (tweenStartRef.current !== null) {
          const b = buffersRef.current
          const raw = Math.min(1, (performance.now() - tweenStartRef.current) / TWEEN_MS)
          const k = easeInOutCubic(raw)
          const pos = b.position.array as Float32Array
          const col = b.color.array as Float32Array
          for (let j = 0; j < n * 3; j++) {
            pos[j] = b.fromPos[j] + (b.toPos[j] - b.fromPos[j]) * k
            col[j] = b.fromCol[j] + (b.toCol[j] - b.fromCol[j]) * k
          }
          b.position.needsUpdate = true
          b.color.needsUpdate = true
          pointsGeo.computeBoundingSphere() // keeps raycasting accurate as points move
          syncLine()
          if (raw >= 1) tweenStartRef.current = null
        }

        // Highlight sphere follows the (moving) path
        const hp = highlightPositionRef.current
        if (hp !== null && n > 0) {
          const target = Math.min(n - 1, Math.max(0, hp))
          currentSphereTRef.current = sphereWasVisible
            ? currentSphereTRef.current + (target - currentSphereTRef.current) * 0.2
            : target
          pathAt(currentSphereTRef.current, highlightMesh.position)
          if (!sphereWasVisible) prevFollowTargetRef.current.copy(highlightMesh.position)
          highlightMesh.visible = true
          sphereWasVisible = true
        } else {
          highlightMesh.visible = false
          sphereWasVisible = false
        }

        const mode = followModeRef.current
        if (mode === 'tracking' && highlightMesh.visible) {
          const newTarget = highlightMesh.position.clone()
          camera.position.add(newTarget.clone().sub(prevFollowTargetRef.current))
          controls.target.copy(newTarget)
          prevFollowTargetRef.current.copy(newTarget)
        } else if (mode === 'following' && highlightMesh.visible && n > 1) {
          const newTarget = highlightMesh.position.clone()
          const offset = camera.position.clone().sub(prevFollowTargetRef.current)
          swingFollowCamera(offset, prevPathTangentRef.current, pathTangentAt(currentSphereTRef.current))
          camera.position.copy(newTarget).add(offset)
          controls.target.copy(newTarget)
          prevFollowTargetRef.current.copy(newTarget)
        }
        controls.update(dt) // dt keeps auto-rotate speed independent of refresh rate
        if (glow) glow.render(dt, camera.position.distanceTo(controls.target), n, glowStrengthRef.current)
        else renderer.render(scene, camera)
      }
      animate()

      const ro = new ResizeObserver(() => {
        const nw = mount.clientWidth
        const nh = mount.clientHeight
        if (nw === 0 || nh === 0) return
        renderer.setSize(nw, nh)
        glow?.setSize(nw, nh)
        camera.aspect = nw / nh
        camera.updateProjectionMatrix()
      })
      ro.observe(mount)

      cleanup = () => {
        cancelAnimationFrame(animId)
        controls.removeEventListener('change', onControlsChange)
        controls.dispose()
        path.dispose()
        glow?.dispose()
        pointsGeo.dispose()
        pointsMat.dispose()
        renderer.dispose()
        ro.disconnect()
        sceneRef.current = null
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
  // Built once; points/highlight flow in through refs
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // retarget only reads refs; re-run on new points only
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => { retarget(points) }, [points])
  useEffect(() => { highlightPositionRef.current = highlightPosition }, [highlightPosition])
  useEffect(() => {
    styleRef.current = { lineWidth, nodeSize, autoRotate, autoRotateSpeed, showGrid }
    const s = sceneRef.current
    if (!s) return
    s.path.setLineWidth(lineWidth)
    s.glow?.setLineWidth(lineWidth)
    s.glow?.setNodeSize(nodeSize)
    s.pointsMat.size = nodeSize
    s.highlightMesh.scale.setScalar(Math.max(1, nodeSize / DEFAULT_NODE_SIZE))
    s.controls.autoRotate = autoRotate
    s.controls.autoRotateSpeed = autoRotateSpeed
    s.grid.visible = showGrid
  }, [lineWidth, nodeSize, autoRotate, autoRotateSpeed, showGrid])

  const hitTest = (e: React.MouseEvent<HTMLDivElement>) => {
    const s = sceneRef.current
    if (!s || countRef.current === 0) return null
    const rect = mountRef.current!.getBoundingClientRect()
    const mouse = new THREE.Vector2(
      ((e.clientX - rect.left) / rect.width) * 2 - 1,
      -((e.clientY - rect.top) / rect.height) * 2 + 1,
    )
    s.raycaster.setFromCamera(mouse, s.camera)
    const hits = s.raycaster.intersectObject(s.pointsMesh)
    return hits.length > 0 ? { idx: hits[0].index!, x: e.clientX - rect.left, y: e.clientY - rect.top } : null
  }

  const handleMouseMove = (e: React.MouseEvent<HTMLDivElement>) => {
    const hit = hitTest(e)
    setTooltip(hit ? { x: hit.x, y: hit.y, text: labelsRef.current[hit.idx] ?? '' } : null)
  }

  const mouseDownRef = useRef<{ x: number; y: number } | null>(null)
  const handleClick = (e: React.MouseEvent<HTMLDivElement>) => {
    const down = mouseDownRef.current
    if (!down) return
    const dx = e.clientX - down.x, dy = e.clientY - down.y
    if (dx * dx + dy * dy > 25) return // >5px movement = drag, not click
    const hit = hitTest(e)
    if (hit) onPointClick(hit.idx)
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
    <div
      className="relative w-full h-full min-h-0 cursor-crosshair [&_canvas]:block [&_canvas]:!w-full [&_canvas]:!h-full"
      ref={mountRef}
      onMouseMove={handleMouseMove}
      onMouseDown={e => { mouseDownRef.current = { x: e.clientX, y: e.clientY } }}
      onClick={handleClick}
    >
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
            const cursorPos = s.highlightMesh.position.clone()
            if (next === 'following' && countRef.current > 1) {
              const tangent = pathTangentAt(currentSphereTRef.current)
              s.camera.position.copy(cursorPos).addScaledVector(tangent, -0.6).add(new THREE.Vector3(0, 0.15, 0))
              s.controls.target.copy(cursorPos)
              prevPathTangentRef.current.copy(tangent)
            }
            prevFollowTargetRef.current.copy(cursorPos)
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
