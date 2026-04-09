import { useEffect, useRef, useState } from 'react'
import * as THREE from 'three'
import { OrbitControls } from 'three/addons/controls/OrbitControls.js'
import type { CameraState, FollowMode } from './scatterTypes'

// Distinct hues per branch: blue, orange, green, purple, yellow, cyan, pink, teal
const BRANCH_HUES = [220, 30, 120, 280, 60, 180, 320, 150]

interface Props {
  points: [number, number, number][]
  labels: string[]
  highlightPosition: number | null  // float: 1.7 = 70% between node 1 and 2
  onPointClick: (index: number) => void
  initialCameraState?: CameraState
  onCameraChange?: (state: CameraState) => void
  /** When provided, colors points by branch and draws separate lines per branch */
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

export default function ScatterPlot3D({ points, labels, highlightPosition, onPointClick, initialCameraState, onCameraChange, branchIds }: Props) {
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
  const targetSphereTRef = useRef(0)   // target float segment index
  const currentSphereTRef = useRef(0)  // animated segment index (lerps toward target)
  const sphereVisibleRef = useRef(false)
  const normalizedRef = useRef<[number, number, number][]>([])

  // Build scene once
  useEffect(() => {
    const mount = mountRef.current!
    let cleanup: (() => void) | undefined

    const init = () => {
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
        let hue: number
        if (branchIds) {
          hue = BRANCH_HUES[branchIds[i] % BRANCH_HUES.length]
        } else {
          hue = (1 - i / (n - 1)) * 240 // blue→red
        }
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

      if (branchIds) {
        // Draw a separate line per branch.
        // For non-root branches, prepend the last root node before the branch so
        // the line visually continues from the branching point.
        const numBranches = Math.max(...branchIds) + 1
        for (let bid = 0; bid < numBranches; bid++) {
          const branchOnly: number[] = []
          for (let i = 0; i < n; i++) if (branchIds[i] === bid) branchOnly.push(i)

          let indices: number[]
          if (bid === 0) {
            indices = branchOnly
          } else {
            // Find the last root node that appears before this branch's first node
            const firstBranchIdx = branchOnly[0]
            let parentIdx = -1
            for (let i = firstBranchIdx - 1; i >= 0; i--) {
              if (branchIds[i] === 0) { parentIdx = i; break }
            }
            indices = parentIdx >= 0 ? [parentIdx, ...branchOnly] : branchOnly
          }

          if (indices.length < 2) continue
          const lPos = new Float32Array(indices.length * 3)
          const lCol = new Float32Array(indices.length * 3)
          for (let j = 0; j < indices.length; j++) {
            const idx = indices[j]
            lPos[j * 3] = normalized[idx][0]; lPos[j * 3 + 1] = normalized[idx][1]; lPos[j * 3 + 2] = normalized[idx][2]
            lCol[j * 3] = colors[idx * 3]; lCol[j * 3 + 1] = colors[idx * 3 + 1]; lCol[j * 3 + 2] = colors[idx * 3 + 2]
          }
          const lg = new THREE.BufferGeometry()
          lg.setAttribute('position', new THREE.BufferAttribute(lPos, 3))
          lg.setAttribute('color', new THREE.BufferAttribute(lCol, 3))
          scene.add(new THREE.Line(lg, new THREE.LineBasicMaterial({ vertexColors: true, opacity: 0.5, transparent: true })))
        }
      } else {
        // Path line through points in transcript order
        const lineGeo = new THREE.BufferGeometry()
        lineGeo.setAttribute('position', new THREE.BufferAttribute(positions.slice(), 3))
        lineGeo.setAttribute('color', new THREE.BufferAttribute(colors.slice(), 3))
        const lineMat = new THREE.LineBasicMaterial({ vertexColors: true, opacity: 0.35, transparent: true })
        const lineMesh = new THREE.Line(lineGeo, lineMat)
        scene.add(lineMesh)
      }

      // Highlight mesh (sphere so it stays visible at any zoom level)
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

      cleanup = () => {
        cancelAnimationFrame(animId)
        controls.removeEventListener('change', onControlsChange)
        controls.dispose()
        renderer.dispose()
        ro.disconnect()
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
  }, [points, branchIds])

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
