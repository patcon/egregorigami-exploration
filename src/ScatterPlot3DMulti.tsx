import { useEffect, useRef, useState } from 'react'
import * as THREE from 'three'
import { OrbitControls } from 'three/addons/controls/OrbitControls.js'
import { trackPalette, SCENE_BG } from './palettes'
import { addTubeLights, createGlowFx, createPathVisual, hash01, type GlowFx, type LiveRenderer, type PathVisual } from './livePathVisuals'
import { swingFollowCamera } from './followCamera'
import { DEFAULT_LINE_WIDTH, DEFAULT_NODE_SIZE } from './ScatterPlot3DLive'
import type { CameraState, FollowMode } from './scatterTypes'

interface Props {
  /** Shared embedding space: all sessions' points, in the order they were embedded. Already aligned. */
  points: [number, number, number][]
  /** Session index of each point (same order as `points`; may be longer). */
  pointTracks: number[]
  /** Hover label of each point (same order as `points`; may be longer). */
  labels: string[]
  /** Number of sessions (paths). */
  trackCount: number
  /** Per session: float index along that session's own path (1.7 = 70% between its nodes 1 and 2). */
  highlights: (number | null)[]
  /** Session whose playhead the camera follows and that's drawn on top. */
  activeTrack: number
  /** Called with the index into `points`. */
  onPointClick: (index: number) => void
  initialCameraState?: CameraState
  onCameraChange?: (state: CameraState) => void
  lineWidth?: number
  nodeSize?: number
  autoRotate?: boolean
  autoRotateSpeed?: number
  showGrid?: boolean
  /** Path style. Read once when the scene is built: remount (e.g. via `key`) to change it. */
  renderer?: LiveRenderer
  /** Bloom intensity multiplier ('glow' only). */
  glowStrength?: number
}

const TWEEN_MS = 900
const GRID_SIZE = 6
const GRID_DIVISIONS = 24
const GRID_Y = -1.2
const ACTIVE_LINE_OPACITY = 0.75
const INACTIVE_LINE_OPACITY = 0.35
const easeInOutCubic = (t: number) => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2)

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
 * Live renderer for several sessions sharing one embedding space (v9). Same
 * tween-in-place approach as ScatterPlot3DLive, but each session gets its own
 * coloured path (line, tube or glow) and playhead.
 */
export default function ScatterPlot3DMulti({ points, pointTracks, labels, trackCount, highlights, activeTrack, onPointClick, initialCameraState, onCameraChange, lineWidth = DEFAULT_LINE_WIDTH, nodeSize = DEFAULT_NODE_SIZE, autoRotate = false, autoRotateSpeed = 1, showGrid = true, renderer: rendererStyle = 'original', glowStrength = 1 }: Props) {
  const mountRef = useRef<HTMLDivElement>(null)
  const sceneRef = useRef<{
    camera: THREE.PerspectiveCamera
    controls: OrbitControls
    pointsMesh: THREE.Points
    pointsMat: THREE.PointsMaterial
    paths: PathVisual[]
    glow: GlowFx | null
    spheres: THREE.Mesh[]
    grid: THREE.GridHelper
    raycaster: THREE.Raycaster
    bgColor: THREE.Color
  } | null>(null)
  const buffersRef = useRef<Buffers>(makeBuffers(64))
  const countRef = useRef(0)
  /** Per session: indices into the shared buffers, in path order. */
  const trackIdxRef = useRef<number[][]>(Array.from({ length: trackCount }, () => []))
  const tweenStartRef = useRef<number | null>(null)
  const pendingPointsRef = useRef<[number, number, number][] | null>(points)
  const pointTracksRef = useRef(pointTracks)
  useEffect(() => { pointTracksRef.current = pointTracks }, [pointTracks])

  const [tooltip, setTooltip] = useState<{ x: number; y: number; text: string; track: number } | null>(null)
  const [followMode, setFollowMode] = useState<FollowMode>(() => initialCameraState?.followMode ?? 'static')
  const followModeRef = useRef<FollowMode>(initialCameraState?.followMode ?? 'static')
  const prevFollowTargetRef = useRef(new THREE.Vector3())
  const prevPathTangentRef = useRef(new THREE.Vector3())
  const highlightsRef = useRef(highlights)
  const activeTrackRef = useRef(activeTrack)
  const sphereTRef = useRef<number[]>(Array(trackCount).fill(0))
  const styleRef = useRef({ lineWidth, nodeSize, autoRotate, autoRotateSpeed, showGrid })
  const glowStrengthRef = useRef(glowStrength)
  useEffect(() => { glowStrengthRef.current = glowStrength }, [glowStrength])
  const labelsRef = useRef(labels)
  useEffect(() => { labelsRef.current = labels }, [labels])
  const onCameraChangeRef = useRef(onCameraChange)
  useEffect(() => { onCameraChangeRef.current = onCameraChange }, [onCameraChange])

  const pointAt = (i: number, out: THREE.Vector3) => {
    const arr = buffersRef.current.position.array as Float32Array
    return out.set(arr[i * 3], arr[i * 3 + 1], arr[i * 3 + 2])
  }

  const pathAt = (track: number, t: number, out: THREE.Vector3) => {
    const idx = trackIdxRef.current[track]
    const n = idx.length
    const ct = Math.max(0, Math.min(n - 1, t))
    // Ride the tube's curve when there is one, so the playhead stays inside it
    if (n >= 2 && sceneRef.current?.paths[track]?.pointAt(ct, out)) return out
    const a = Math.floor(ct), b = Math.min(n - 1, a + 1)
    const pa = pointAt(idx[a], new THREE.Vector3())
    const pb = pointAt(idx[b], new THREE.Vector3())
    return out.copy(pa).lerp(pb, ct - a)
  }

  const pathTangentAt = (track: number, t: number) => {
    const idx = trackIdxRef.current[track]
    const a = Math.max(0, Math.min(idx.length - 2, Math.floor(t)))
    return pointAt(idx[a + 1], new THREE.Vector3()).sub(pointAt(idx[a], new THREE.Vector3())).normalize()
  }

  /** Rebuild each session's path from the shared (possibly mid-tween) buffers. */
  const syncLines = () => {
    const s = sceneRef.current
    if (!s) return
    const b = buffersRef.current
    const pos = b.position.array as Float32Array
    const col = b.color.array as Float32Array
    s.paths.forEach((path, k) => {
      const idx = trackIdxRef.current[k]
      const p = new Float32Array(idx.length * 3)
      const c = new Float32Array(idx.length * 3)
      idx.forEach((gi, j) => {
        for (let d = 0; d < 3; d++) { p[j * 3 + d] = pos[gi * 3 + d]; c[j * 3 + d] = col[gi * 3 + d] }
      })
      path.update(p, c, idx.length)
    })
  }

  const applyActiveStyle = () => {
    const s = sceneRef.current
    if (!s) return
    const active = activeTrackRef.current
    const nodeScale = Math.max(1, styleRef.current.nodeSize / DEFAULT_NODE_SIZE)
    s.paths.forEach((path, k) => path.setEmphasis({
      lineOpacity: k === active ? ACTIVE_LINE_OPACITY : INACTIVE_LINE_OPACITY,
      dimmed: k !== active,
      renderOrder: k === active ? 1 : 0,
    }))
    s.spheres.forEach((m, k) => m.scale.setScalar(nodeScale * (k === active ? 1.25 : 0.85)))
  }

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
    const tracks = pointTracksRef.current
    const idx: number[][] = Array.from({ length: trackCount }, () => [])
    for (let i = 0; i < n; i++) idx[tracks[i] ?? 0]?.push(i)
    trackIdxRef.current = idx

    const prevN = countRef.current
    const pos = buf.position.array as Float32Array
    const col = buf.color.array as Float32Array
    buf.fromPos.set(pos.subarray(0, n * 3))
    buf.fromCol.set(col.subarray(0, n * 3))
    idx.forEach((list, k) => list.forEach((i, j) => {
      const c = trackPalette(k, list.length > 1 ? j / (list.length - 1) : 0)
      buf.toPos[i * 3] = next[i][0]; buf.toPos[i * 3 + 1] = next[i][1]; buf.toPos[i * 3 + 2] = next[i][2]
      buf.toCol[i * 3] = c.r; buf.toCol[i * 3 + 1] = c.g; buf.toCol[i * 3 + 2] = c.b
      if (i >= prevN) {
        buf.fromPos[i * 3] = next[i][0]; buf.fromPos[i * 3 + 1] = next[i][1]; buf.fromPos[i * 3 + 2] = next[i][2]
        buf.fromCol[i * 3] = s.bgColor.r; buf.fromCol[i * 3 + 1] = s.bgColor.g; buf.fromCol[i * 3 + 2] = s.bgColor.b
      }
    }))
    countRef.current = n
    s.pointsMesh.geometry.setDrawRange(0, n)
    syncLines()
    tweenStartRef.current = performance.now()
  }

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

      const paths = Array.from({ length: trackCount }, () => createPathVisual(rendererStyle, scene, styleRef.current.lineWidth, glow))

      // Playheads: red like the single-session view (the active one is drawn larger, see applyActiveStyle)
      const spheres = Array.from({ length: trackCount }, () => {
        const m = new THREE.Mesh(new THREE.SphereGeometry(0.04, 16, 16), new THREE.MeshBasicMaterial({ color: 0xff2222 }))
        m.visible = false
        scene.add(m)
        return m
      })

      const grid = new THREE.GridHelper(GRID_SIZE, GRID_DIVISIONS, 0x8a8a8a, 0x4a4a4a)
      grid.position.y = GRID_Y
      const gridMat = grid.material as THREE.LineBasicMaterial
      gridMat.transparent = true
      gridMat.depthWrite = false
      grid.visible = styleRef.current.showGrid
      scene.add(grid)

      const raycaster = new THREE.Raycaster()
      raycaster.params.Points!.threshold = 0.05

      sceneRef.current = { camera, controls, pointsMesh, pointsMat, paths, glow, spheres, grid, raycaster, bgColor }
      applyActiveStyle()
      if (pendingPointsRef.current) { retarget(pendingPointsRef.current); pendingPointsRef.current = null }
      else { pointsGeo.setDrawRange(0, countRef.current); syncLines() } // rebuilt scene (StrictMode remount)

      let animId = 0
      const sphereWasVisible = Array(trackCount).fill(false)
      let lastFollowed = activeTrackRef.current
      let lastFrame = performance.now()
      const animate = () => {
        animId = requestAnimationFrame(animate)
        const now = performance.now()
        const dt = Math.min(0.1, (now - lastFrame) / 1000)
        lastFrame = now
        const n = countRef.current

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
          pointsGeo.computeBoundingSphere()
          syncLines()
          if (raw >= 1) tweenStartRef.current = null
        }

        spheres.forEach((sphere, k) => {
          const hp = highlightsRef.current[k]
          const len = trackIdxRef.current[k]?.length ?? 0
          if (hp !== null && hp !== undefined && len > 0) {
            const target = Math.min(len - 1, Math.max(0, hp))
            sphereTRef.current[k] = sphereWasVisible[k]
              ? sphereTRef.current[k] + (target - sphereTRef.current[k]) * 0.2
              : target
            pathAt(k, sphereTRef.current[k], sphere.position)
            sphere.visible = true
            sphereWasVisible[k] = true
          } else {
            sphere.visible = false
            sphereWasVisible[k] = false
          }
        })

        // Follow the active session's playhead; re-anchor when the active session changes
        const active = activeTrackRef.current
        const followed = spheres[active]
        if (active !== lastFollowed && followed?.visible) {
          prevFollowTargetRef.current.copy(followed.position)
          prevPathTangentRef.current.set(0, 0, 0)
          lastFollowed = active
        }
        const mode = followModeRef.current
        if (mode === 'tracking' && followed?.visible) {
          const newTarget = followed.position.clone()
          camera.position.add(newTarget.clone().sub(prevFollowTargetRef.current))
          controls.target.copy(newTarget)
          prevFollowTargetRef.current.copy(newTarget)
        } else if (mode === 'following' && followed?.visible && (trackIdxRef.current[active]?.length ?? 0) > 1) {
          const newTarget = followed.position.clone()
          const offset = camera.position.clone().sub(prevFollowTargetRef.current)
          swingFollowCamera(offset, prevPathTangentRef.current, pathTangentAt(active, sphereTRef.current[active]))
          camera.position.copy(newTarget).add(offset)
          controls.target.copy(newTarget)
          prevFollowTargetRef.current.copy(newTarget)
        }
        controls.update(dt)
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
        paths.forEach(p => p.dispose())
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
  // Built once; data flows in through refs
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => { retarget(points) }, [points])
  useEffect(() => { highlightsRef.current = highlights }, [highlights])
  useEffect(() => {
    activeTrackRef.current = activeTrack
    applyActiveStyle()
  }, [activeTrack])
  useEffect(() => {
    styleRef.current = { lineWidth, nodeSize, autoRotate, autoRotateSpeed, showGrid }
    const s = sceneRef.current
    if (!s) return
    s.paths.forEach(p => p.setLineWidth(lineWidth))
    s.glow?.setLineWidth(lineWidth)
    s.glow?.setNodeSize(nodeSize)
    s.pointsMat.size = nodeSize
    s.controls.autoRotate = autoRotate
    s.controls.autoRotateSpeed = autoRotateSpeed
    s.grid.visible = showGrid
    applyActiveStyle()
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
    setTooltip(hit ? { x: hit.x, y: hit.y, text: labelsRef.current[hit.idx] ?? '', track: pointTracksRef.current[hit.idx] ?? 0 } : null)
  }

  const mouseDownRef = useRef<{ x: number; y: number } | null>(null)
  const handleClick = (e: React.MouseEvent<HTMLDivElement>) => {
    const down = mouseDownRef.current
    if (!down) return
    const dx = e.clientX - down.x, dy = e.clientY - down.y
    if (dx * dx + dy * dy > 25) return
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
          <span className="font-semibold" style={{ color: `#${trackPalette(tooltip.track, 0.5).getHexString()}` }}>Session {String.fromCharCode(65 + tooltip.track)}</span>
          {'\n'}{tooltip.text}
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
          const active = activeTrackRef.current
          const sphere = s?.spheres[active]
          if (s && sphere?.visible) {
            const cursorPos = sphere.position.clone()
            if (next === 'following' && (trackIdxRef.current[active]?.length ?? 0) > 1) {
              const tangent = pathTangentAt(active, sphereTRef.current[active])
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
