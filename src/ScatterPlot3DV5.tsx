import { useEffect, useRef, useState } from 'react'
import * as THREE from 'three'
import { OrbitControls } from 'three/addons/controls/OrbitControls.js'
import './ScatterPlot3D.css'
import type { CameraState, FollowMode } from './scatterTypes'

interface Props {
  points: [number, number, number][]
  labels: string[]
  highlightPosition: number | null  // float: 1.7 = 70% between node 1 and 2
  onPointClick: (index: number) => void
  initialCameraState?: CameraState
  onCameraChange?: (state: CameraState) => void
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

function cividis(t: number): THREE.Color {
  const lut = [
    [0.000, 0.122, 0.302],  // t=0.0  dark navy
    [0.122, 0.267, 0.420],  // t=0.1
    [0.216, 0.342, 0.456],  // t=0.2
    [0.300, 0.416, 0.469],  // t=0.3
    [0.379, 0.488, 0.468],  // t=0.4
    [0.456, 0.560, 0.450],  // t=0.5
    [0.543, 0.630, 0.414],  // t=0.6
    [0.643, 0.698, 0.352],  // t=0.7
    [0.759, 0.764, 0.256],  // t=0.8
    [0.877, 0.826, 0.125],  // t=0.9
    [0.996, 0.908, 0.145],  // t=1.0  bright yellow
  ]
  const scaled = Math.min(0.9999, Math.max(0, t)) * (lut.length - 1)
  const lo = Math.floor(scaled), hi = lo + 1
  const f = scaled - lo
  const [r, g, b] = lut[lo].map((v, i) => v + f * (lut[hi][i] - v))
  return new THREE.Color(r, g, b)
}

export default function ScatterPlot3DV5({ points, labels, highlightPosition, onPointClick, initialCameraState, onCameraChange }: Props) {
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
    curve: THREE.CatmullRomCurve3
  } | null>(null)
  const [tooltip, setTooltip] = useState<{ x: number; y: number; text: string } | null>(null)
  const [followMode, setFollowMode] = useState<FollowMode>(() => initialCameraState?.followMode ?? 'static')
  const followModeRef = useRef<FollowMode>(initialCameraState?.followMode ?? 'static')
  const prevFollowTargetRef = useRef(new THREE.Vector3())
  const prevPathTangentRef = useRef(new THREE.Vector3())
  const highlightPositionRef = useRef<number | null>(null)
  const targetSphereTRef = useRef(0)   // target curve parameter [0,1]
  const currentSphereTRef = useRef(0)  // animated curve parameter (lerps toward target)
  const sphereVisibleRef = useRef(false)
  const normalizedRef = useRef<[number, number, number][]>([])

  // Build scene once
  useEffect(() => {
    const mount = mountRef.current!
    const w = mount.clientWidth
    const h = mount.clientHeight

    const renderer = new THREE.WebGLRenderer({ antialias: true })
    renderer.setSize(w, h)
    renderer.setPixelRatio(window.devicePixelRatio)
    const bgColor = getComputedStyle(document.documentElement).getPropertyValue('--bg').trim() || '#0f1117'
    renderer.setClearColor(new THREE.Color(bgColor))
    mount.appendChild(renderer.domElement)

    const scene = new THREE.Scene()
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

    // Points for raycasting (hover/click)
    const positions = new Float32Array(n * 3)
    const colors = new Float32Array(n * 3)
    for (let i = 0; i < n; i++) {
      positions[i * 3] = normalized[i][0]
      positions[i * 3 + 1] = normalized[i][1]
      positions[i * 3 + 2] = normalized[i][2]
      const c = cividis(i / (n - 1))
      colors[i * 3] = c.r
      colors[i * 3 + 1] = c.g
      colors[i * 3 + 2] = c.b
    }

    const geo = new THREE.BufferGeometry()
    geo.setAttribute('position', new THREE.BufferAttribute(positions, 3))
    geo.setAttribute('color', new THREE.BufferAttribute(colors, 3))
    const mat = new THREE.PointsMaterial({ size: 0.025, sizeAttenuation: true, vertexColors: true })
    const pointsMesh = new THREE.Points(geo, mat)
    scene.add(pointsMesh)

    // Curved tube path (protein-folding aesthetic).
    // Use centripetal parameterization so the curve never overshoots or loops
    // when adjacent segments are far apart in 3D space — prevents the sphere
    // from visually reversing direction as it follows the curve.
    const curve = new THREE.CatmullRomCurve3(
      normalized.map(([x, y, z]) => new THREE.Vector3(x, y, z)),
      false,
      'centripetal'
    )

    const TUBE_SEGMENTS = Math.max(64, normalized.length * 6)
    const RADIAL_SEGMENTS = 10
    const TUBE_RADIUS = 0.025

    const tubeGeo = new THREE.TubeGeometry(curve, TUBE_SEGMENTS, TUBE_RADIUS, RADIAL_SEGMENTS, false)

    const tubeColors = new Float32Array(tubeGeo.attributes.position.count * 3)
    const vertsPerRing = RADIAL_SEGMENTS + 1
    for (let v = 0; v < tubeGeo.attributes.position.count; v++) {
      const ring = Math.floor(v / vertsPerRing)
      const t = ring / TUBE_SEGMENTS
      const c = cividis(t)
      // Alternate brightness between node-to-node segments to show spacing
      const segIdx = Math.floor(Math.min(t * (normalized.length - 1), normalized.length - 2))
      const bright = segIdx % 2 === 0 ? 1.2 : 0.7
      tubeColors[v * 3] = Math.min(1, c.r * bright)
      tubeColors[v * 3 + 1] = Math.min(1, c.g * bright)
      tubeColors[v * 3 + 2] = Math.min(1, c.b * bright)
    }
    tubeGeo.setAttribute('color', new THREE.BufferAttribute(tubeColors, 3))

    const tubeMat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.6, metalness: 0.1 })
    const tubeMesh = new THREE.Mesh(tubeGeo, tubeMat)
    scene.add(tubeMesh)

    // Lighting for MeshStandardMaterial
    scene.add(new THREE.AmbientLight(0xffffff, 0.7))
    scene.add(new THREE.DirectionalLight(0xffffff, 0.8))

    // Highlight mesh (sphere)
    const hlGeo = new THREE.SphereGeometry(0.04, 16, 16)
    const hlMat = new THREE.MeshBasicMaterial({ color: 0xff2222 })
    const highlightMesh = new THREE.Mesh(hlGeo, hlMat)
    highlightMesh.visible = false
    scene.add(highlightMesh)

    const raycaster = new THREE.Raycaster()
    raycaster.params.Points!.threshold = 0.05

    let animId = 0
    let firstFrame = true
    const animate = () => {
      animId = requestAnimationFrame(animate)
      // Lerp the curve parameter so the sphere travels along the tube path.
      // On the first visible frame, snap to target and seed prevFollowTargetRef.
      if (sphereVisibleRef.current) {
        if (firstFrame) {
          currentSphereTRef.current = targetSphereTRef.current
          const spherePos = curve.getPoint(currentSphereTRef.current)
          highlightMesh.position.copy(spherePos)
          prevFollowTargetRef.current.copy(spherePos)
          firstFrame = false
        } else {
          currentSphereTRef.current += (targetSphereTRef.current - currentSphereTRef.current) * 0.2
          highlightMesh.position.copy(curve.getPoint(currentSphereTRef.current))
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
        const currTangent = curve.getTangent(Math.max(0.0001, Math.min(0.9999, currentSphereTRef.current)))
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
      renderer.render(scene, camera)
    }
    animate()

    const ro = new ResizeObserver(() => {
      const nw = mount.clientWidth
      const nh = mount.clientHeight
      renderer.setSize(nw, nh)
      camera.aspect = nw / nh
      camera.updateProjectionMatrix()
    })
    ro.observe(mount)

    sceneRef.current = { renderer, camera, controls, scene, pointsMesh, highlightMesh, raycaster, animId, curve }

    return () => {
      cancelAnimationFrame(animId)
      controls.removeEventListener('change', onControlsChange)
      controls.dispose()
      renderer.dispose()
      ro.disconnect()
      if (mount.contains(renderer.domElement)) mount.removeChild(renderer.domElement)
    }
  }, [points])

  // Highlight updates — set target position on curve; RAF lerps sphere towards it each frame
  useEffect(() => {
    highlightPositionRef.current = highlightPosition
    const normalized = normalizedRef.current
    if (highlightPosition !== null && normalized.length > 0) {
      targetSphereTRef.current = Math.min(1, Math.max(0, highlightPosition / (normalized.length - 1)))
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
      const idx = hits[0].index!
      setTooltip({ x: e.clientX - rect.left, y: e.clientY - rect.top, text: labels[idx] })
    } else {
      setTooltip(null)
    }
  }

  const mouseDownRef = useRef<{ x: number; y: number } | null>(null)

  const handleMouseDown = (e: React.MouseEvent<HTMLDivElement>) => {
    mouseDownRef.current = { x: e.clientX, y: e.clientY }
  }

  const handleClick = (e: React.MouseEvent<HTMLDivElement>) => {
    const down = mouseDownRef.current
    if (!down) return
    const dx = e.clientX - down.x
    const dy = e.clientY - down.y
    if (dx * dx + dy * dy > 25) return // >5px movement = drag, not click
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

  return (
    <div className="scatter-wrap" ref={mountRef} onMouseMove={handleMouseMove} onMouseDown={handleMouseDown} onClick={handleClick}>
      {tooltip && (
        <div className="scatter-tooltip" style={{ left: tooltip.x + 12, top: tooltip.y + 12 }}>
          {tooltip.text}
        </div>
      )}
      <button
        className={`scatter-follow-btn${followMode !== 'static' ? ` ${followMode}` : ''}`}
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
              const hp = highlightPositionRef.current ?? 0
              const t = Math.max(0.0001, Math.min(0.9999, hp / (normalizedRef.current.length - 1)))
              const tangent = s.curve.getTangent(t)
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
