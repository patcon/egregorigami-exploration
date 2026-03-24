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

export default function ScatterPlot3D({ points, labels, highlightPosition, onPointClick, initialCameraState, onCameraChange }: Props) {
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
  } | null>(null)
  const [tooltip, setTooltip] = useState<{ x: number; y: number; text: string } | null>(null)
  const [followMode, setFollowMode] = useState<FollowMode>(() => initialCameraState?.followMode ?? 'static')
  const followModeRef = useRef<FollowMode>(initialCameraState?.followMode ?? 'static')
  const prevFollowTargetRef = useRef(new THREE.Vector3())
  const prevPathTangentRef = useRef(new THREE.Vector3())
  const highlightPositionRef = useRef<number | null>(null)
  const targetSphereRef = useRef(new THREE.Vector3())
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

    const positions = new Float32Array(n * 3)
    const colors = new Float32Array(n * 3)
    for (let i = 0; i < n; i++) {
      positions[i * 3] = normalized[i][0]
      positions[i * 3 + 1] = normalized[i][1]
      positions[i * 3 + 2] = normalized[i][2]
      const hue = (1 - i / (n - 1)) * 240 // blue→red
      const color = new THREE.Color().setHSL(hue / 360, 1, 0.55)
      colors[i * 3] = color.r
      colors[i * 3 + 1] = color.g
      colors[i * 3 + 2] = color.b
    }

    const geo = new THREE.BufferGeometry()
    geo.setAttribute('position', new THREE.BufferAttribute(positions, 3))
    geo.setAttribute('color', new THREE.BufferAttribute(colors, 3))
    const mat = new THREE.PointsMaterial({ size: 0.04, sizeAttenuation: true, vertexColors: true })
    const pointsMesh = new THREE.Points(geo, mat)
    scene.add(pointsMesh)

    // Path line through points in transcript order
    const lineGeo = new THREE.BufferGeometry()
    lineGeo.setAttribute('position', new THREE.BufferAttribute(positions.slice(), 3))
    lineGeo.setAttribute('color', new THREE.BufferAttribute(colors.slice(), 3))
    const lineMat = new THREE.LineBasicMaterial({ vertexColors: true, opacity: 0.35, transparent: true })
    const lineMesh = new THREE.Line(lineGeo, lineMat)
    scene.add(lineMesh)

    // Highlight mesh (sphere so it stays visible at any zoom level)
    const hlGeo = new THREE.SphereGeometry(0.04, 16, 16)
    const hlMat = new THREE.MeshBasicMaterial({ color: 0xff2222 })
    const highlightMesh = new THREE.Mesh(hlGeo, hlMat)
    highlightMesh.visible = false
    scene.add(highlightMesh)

    const raycaster = new THREE.Raycaster()
    raycaster.params.Points!.threshold = 0.05

    let animId = 0
    const animate = () => {
      animId = requestAnimationFrame(animate)
      // Smoothly lerp sphere towards target position set by the highlight effect
      if (sphereVisibleRef.current) {
        highlightMesh.position.lerp(targetSphereRef.current, 0.2)
        highlightMesh.visible = true
      } else {
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

    sceneRef.current = { renderer, camera, controls, scene, pointsMesh, highlightMesh, raycaster, animId }

    return () => {
      cancelAnimationFrame(animId)
      controls.removeEventListener('change', onControlsChange)
      controls.dispose()
      renderer.dispose()
      ro.disconnect()
      if (mount.contains(renderer.domElement)) mount.removeChild(renderer.domElement)
    }
  }, [points])

  // Highlight updates — set target position; RAF lerps sphere towards it each frame
  useEffect(() => {
    highlightPositionRef.current = highlightPosition
    const normalized = normalizedRef.current
    if (highlightPosition !== null && normalized.length > 0) {
      const a = Math.max(0, Math.floor(highlightPosition))
      const b = Math.min(normalized.length - 1, Math.ceil(highlightPosition))
      const t = highlightPosition - a
      const pa = normalized[a]
      const pb = normalized[b]
      targetSphereRef.current.set(
        pa[0] + (pb[0] - pa[0]) * t,
        pa[1] + (pb[1] - pa[1]) * t,
        pa[2] + (pb[2] - pa[2]) * t,
      )
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
