import { useEffect, useRef, useState } from 'react'
import * as THREE from 'three'
import { OrbitControls } from 'three/addons/controls/OrbitControls.js'
import './ScatterPlot3D.css'

interface Props {
  points: [number, number, number][]
  labels: string[]
  highlightPosition: number | null  // float: 1.7 = 70% between node 1 and 2
  onPointClick: (index: number) => void
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

export default function ScatterPlot3D({ points, labels, highlightPosition, onPointClick }: Props) {
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
  const [followCursor, setFollowCursor] = useState(false)
  const followCursorRef = useRef(false)
  const prevFollowTargetRef = useRef(new THREE.Vector3())
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
      if (followCursorRef.current && highlightMesh.visible) {
        const newTarget = highlightMesh.position.clone()
        const delta = newTarget.clone().sub(prevFollowTargetRef.current)
        camera.position.add(delta)
        controls.target.copy(newTarget)
        prevFollowTargetRef.current.copy(newTarget)
      }
      controls.update()
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
      controls.dispose()
      renderer.dispose()
      ro.disconnect()
      if (mount.contains(renderer.domElement)) mount.removeChild(renderer.domElement)
    }
  }, [points])

  // Highlight updates without scene rebuild — lerp between adjacent nodes for smooth motion
  useEffect(() => {
    const s = sceneRef.current
    if (!s) return
    const normalized = normalizedRef.current
    if (highlightPosition !== null && normalized.length > 0) {
      const a = Math.max(0, Math.floor(highlightPosition))
      const b = Math.min(normalized.length - 1, Math.ceil(highlightPosition))
      const t = highlightPosition - a
      const pa = normalized[a]
      const pb = normalized[b]
      const x = pa[0] + (pb[0] - pa[0]) * t
      const y = pa[1] + (pb[1] - pa[1]) * t
      const z = pa[2] + (pb[2] - pa[2]) * t
      s.highlightMesh.position.set(x, y, z)
      s.highlightMesh.visible = true
    } else {
      s.highlightMesh.visible = false
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
        className={`scatter-follow-btn${followCursor ? ' active' : ''}`}
        onClick={e => {
          e.stopPropagation()
          const next = !followCursor
          setFollowCursor(next)
          followCursorRef.current = next
          if (next && sceneRef.current?.highlightMesh.visible) {
            prevFollowTargetRef.current.copy(sceneRef.current.highlightMesh.position)
          }
        }}
      >
        {followCursor ? 'Following ◎' : 'Follow ◎'}
      </button>
    </div>
  )
}
