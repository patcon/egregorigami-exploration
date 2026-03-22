import { useEffect, useRef, useState } from 'react'
import * as THREE from 'three'
import { OrbitControls } from 'three/addons/controls/OrbitControls.js'
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js'
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js'
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js'
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js'
import './ScatterPlot3D.css'

interface Props {
  points: [number, number, number][]
  labels: string[]
  highlightPosition: number | null
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

function cividis(t: number): THREE.Color {
  const lut = [
    [0.000, 0.122, 0.302],
    [0.122, 0.267, 0.420],
    [0.216, 0.342, 0.456],
    [0.300, 0.416, 0.469],
    [0.379, 0.488, 0.468],
    [0.456, 0.560, 0.450],
    [0.543, 0.630, 0.414],
    [0.643, 0.698, 0.352],
    [0.759, 0.764, 0.256],
    [0.877, 0.826, 0.125],
    [0.996, 0.908, 0.145],
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

const fragmentShader = /* glsl */`
varying vec3 vColor;
varying float vSeed;
uniform float uTime;

void main() {
  vec2 uv = gl_PointCoord - 0.5;
  float d = length(uv);
  if (d > 0.5) discard;
  float alpha = 1.0 - smoothstep(0.25, 0.5, d);
  // Each point pulses at its own phase, derived from its random seed
  float pulse = 0.65 + 0.35 * sin(vSeed * 50.0 + uTime * 2.5);
  gl_FragColor = vec4(vColor * pulse, alpha);
}
`

export default function ScatterPlot3DV6({ points, labels, highlightPosition, onPointClick }: Props) {
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
  type FollowMode = 'static' | 'tracking' | 'following'
  const [tooltip, setTooltip] = useState<{ x: number; y: number; text: string } | null>(null)
  const [followMode, setFollowMode] = useState<FollowMode>('static')
  const followModeRef = useRef<FollowMode>('static')
  const prevFollowTargetRef = useRef(new THREE.Vector3())
  const prevPathTangentRef = useRef(new THREE.Vector3())
  const highlightPositionRef = useRef<number | null>(null)
  const targetSphereRef = useRef(new THREE.Vector3())
  const sphereVisibleRef = useRef(false)
  const normalizedRef = useRef<[number, number, number][]>([])

  useEffect(() => {
    const mount = mountRef.current!
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
      const c = cividis(i / (n - 1))
      aColors[i * 3] = c.r
      aColors[i * 3 + 1] = c.g
      aColors[i * 3 + 2] = c.b
      aSeeds[i] = Math.random()
    }

    const geo = new THREE.BufferGeometry()
    geo.setAttribute('position', new THREE.BufferAttribute(positions, 3))
    geo.setAttribute('aColor', new THREE.BufferAttribute(aColors, 3))
    geo.setAttribute('aSeed', new THREE.BufferAttribute(aSeeds, 1))

    const uniforms = { uTime: { value: 0 } }
    const mat = new THREE.ShaderMaterial({
      uniforms,
      vertexShader,
      fragmentShader,
      transparent: true,
      depthWrite: false,
    })

    const pointsMesh = new THREE.Points(geo, mat)
    scene.add(pointsMesh)

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
    const animate = () => {
      animId = requestAnimationFrame(animate)
      uniforms.uTime.value += 0.016
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

    return () => {
      cancelAnimationFrame(animId)
      controls.dispose()
      composer.dispose()
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
      const pa = normalized[a], pb = normalized[b]
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
        }}
      >
        {followMode === 'static' ? '◎ Static' : followMode === 'tracking' ? '◉ Tracking' : '⬤ Following'}
      </button>
    </div>
  )
}
