import { useState, useMemo, useRef } from 'react'
import { EMBEDDING_MODELS, type EmbeddingModelId } from './embedSegments'
import { useEmbeddingWorker } from './useEmbeddingWorker'
import ScatterPlot3D from './ScatterPlot3D'
import ScatterPlot3DV5 from './ScatterPlot3DV5'
import ScatterPlot3DV6 from './ScatterPlot3DV6'
import type { CameraState } from './scatterTypes'

type RendererType = 'original' | 'cividis-tube' | 'glow'

const RENDERER_LABELS: Record<RendererType, string> = {
  'original':    'Points',
  'cividis-tube': 'Tube',
  'glow':        'Glow',
}

const EXAMPLE_INPUT = `Why
Why does
Why does a moon
Why does a moon rock
Why does a moon rock taste
Why does a moon rock taste better
Why does a moon rock taste better than
Why does a moon rock taste better than an Earth
Why does a moon rock taste better than an Earth rock?
Why does a moon rock taste better than an Earth rock? It's
Why does a moon rock taste better than an Earth rock? It's a little
- Why does a moon rock taste better than an Earth rock? It's a little meteor. [space]
- Why does a moon rock taste better than an Earth rock? It's a little meatier. [taste]`

interface ParsedSegment {
  text: string
  branchId: number
}

function parseInput(raw: string): ParsedSegment[] {
  const lines = raw.split('\n')
  const segments: ParsedSegment[] = []
  let currentBranchId = 0
  let nextBranchId = 1

  for (const line of lines) {
    if (!line.trim()) continue

    if (line.startsWith('- ')) {
      currentBranchId = nextBranchId++
      segments.push({ text: line.slice(2).trim(), branchId: currentBranchId })
    } else if (/^\s/.test(line) && currentBranchId !== 0) {
      segments.push({ text: line.trim(), branchId: currentBranchId })
    } else {
      currentBranchId = 0
      segments.push({ text: line.trim(), branchId: 0 })
    }
  }

  return segments
}

export default function ManualEmbeddingProjector() {
  const [inputText, setInputText] = useState(EXAMPLE_INPUT)
  const [selectedModel, setSelectedModel] = useState<EmbeddingModelId>(
    EMBEDDING_MODELS.find(m => m.default)!.id
  )
  const [submitted, setSubmitted] = useState<ParsedSegment[] | null>(null)
  const [rendererType, setRendererType] = useState<RendererType>('original')
  const cameraStateRef = useRef<CameraState | undefined>(undefined)
  const { phase, runEmbedding, cancelEmbedding, resetPhase } = useEmbeddingWorker()

  const handleEmbed = () => {
    const segments = parseInput(inputText)
    if (segments.length < 2) return
    setSubmitted(segments)
    resetPhase()
    runEmbedding(segments.map(s => s.text), selectedModel)
  }

  const handleReset = () => {
    cancelEmbedding()
    setSubmitted(null)
  }

  const nonEmptyLines = inputText.split('\n').filter(l => l.trim())
  const isMultiline = nonEmptyLines.length > 1

  const handleExpand = () => {
    if (isMultiline) return
    const words = inputText.trim().split(/\s+/)
    if (!words[0]) return
    setInputText(words.map((_, i) => words.slice(0, i + 1).join(' ')).join('\n'))
  }

  const branchIds = useMemo(
    () => submitted?.map(s => s.branchId) ?? null,
    [submitted]
  )

  const labels = useMemo(
    () => submitted?.map(s => s.text) ?? [],
    [submitted]
  )

  const isRunning = phase.status === 'model-loading' || phase.status === 'embedding' || phase.status === 'umap-running'
  const isDone = phase.status === 'done'

  return (
    <div className="flex flex-col h-screen bg-[var(--bg)] text-[var(--text)] overflow-hidden">
      {/* Header */}
      <div className="flex items-center gap-3 px-4 py-3 border-b border-[var(--border)] shrink-0">
        <h2 className="text-sm font-semibold m-0 grow">Manual Branching Projector</h2>
        {isDone && (
          <button
            className="text-xs px-2 py-1 rounded border border-[var(--border)] opacity-60 hover:opacity-100 transition-opacity"
            onClick={handleReset}
          >
            ← Edit input
          </button>
        )}
      </div>

      {!isDone ? (
        /* Input panel */
        <div className="flex flex-col gap-3 p-4 max-w-2xl w-full mx-auto mt-4">
          <p className="text-xs opacity-60 m-0">
            Each line = one embedding node. Use <code className="bg-[rgba(255,255,255,0.08)] px-1 rounded">- </code> to start a new branch; indent with spaces to continue it.
          </p>
          <div className="relative">
            <textarea
              className="w-full font-mono text-sm rounded border border-[var(--border)] bg-[rgba(255,255,255,0.04)] p-3 resize-y min-h-[220px] focus:outline-none focus:border-[var(--accent-border)]"
              value={inputText}
              onChange={e => setInputText(e.target.value)}
              spellCheck={false}
              disabled={isRunning}
            />
            <button
              className="absolute bottom-2 right-2 text-[11px] px-2 py-[3px] rounded border transition-[background,color,opacity] duration-150 disabled:opacity-30 disabled:cursor-not-allowed border-[var(--border)] bg-black/40 text-white/60 hover:enabled:bg-black/70 hover:enabled:text-white"
              onClick={handleExpand}
              disabled={isMultiline || isRunning}
              title={isMultiline ? 'Already multiline — clear to a single sentence first' : 'Expand sentence word-by-word'}
            >
              Expand ↓
            </button>
          </div>

          <div className="flex items-center gap-3">
            <select
              className="text-xs rounded border border-[var(--border)] bg-[rgba(255,255,255,0.06)] px-2 py-1 grow focus:outline-none"
              value={selectedModel}
              onChange={e => setSelectedModel(e.target.value as EmbeddingModelId)}
              disabled={isRunning}
            >
              {EMBEDDING_MODELS.map(m => (
                <option key={m.id} value={m.id}>{m.label}</option>
              ))}
            </select>

            {!isRunning ? (
              <button
                className="text-xs px-3 py-1.5 rounded border border-[var(--accent-border)] bg-[rgba(80,140,255,0.15)] hover:bg-[rgba(80,140,255,0.3)] transition-colors shrink-0"
                onClick={handleEmbed}
              >
                Embed
              </button>
            ) : (
              <button
                className="text-xs px-3 py-1.5 rounded border border-[var(--border)] opacity-70 hover:opacity-100 transition-opacity shrink-0"
                onClick={handleReset}
              >
                Cancel
              </button>
            )}
          </div>

          {/* Progress */}
          {phase.status === 'model-loading' && (
            <p className="text-xs opacity-60 m-0">Loading model… {phase.progress}%</p>
          )}
          {phase.status === 'embedding' && (
            <p className="text-xs opacity-60 m-0">Embedding {phase.loaded}/{phase.total}…</p>
          )}
          {phase.status === 'umap-running' && (
            <p className="text-xs opacity-60 m-0">Running UMAP…</p>
          )}
          {phase.status === 'error' && (
            <p className="text-xs text-red-400 m-0">Error: {phase.message}</p>
          )}
        </div>
      ) : (
        /* 3D scatter */
        <div className="flex-1 min-h-0 relative">
          {rendererType === 'original' && (
            <ScatterPlot3D
              points={phase.points}
              labels={labels}
              branchIds={branchIds ?? undefined}
              highlightPosition={null}
              onPointClick={() => {}}
              initialCameraState={cameraStateRef.current}
              onCameraChange={s => { cameraStateRef.current = s }}
            />
          )}
          {rendererType === 'cividis-tube' && (
            <ScatterPlot3DV5
              points={phase.points}
              labels={labels}
              branchIds={branchIds ?? undefined}
              highlightPosition={null}
              onPointClick={() => {}}
              initialCameraState={cameraStateRef.current}
              onCameraChange={s => { cameraStateRef.current = s }}
            />
          )}
          {rendererType === 'glow' && (
            <ScatterPlot3DV6
              points={phase.points}
              labels={labels}
              branchIds={branchIds ?? undefined}
              highlightPosition={null}
              onPointClick={() => {}}
              initialCameraState={cameraStateRef.current}
              onCameraChange={s => { cameraStateRef.current = s }}
            />
          )}

          {/* Renderer toggle */}
          <div className="absolute top-2 right-2 flex gap-1 z-10 pointer-events-auto">
            {(Object.keys(RENDERER_LABELS) as RendererType[]).map(r => (
              <button
                key={r}
                className={[
                  'text-[11px] py-[3px] px-2 rounded border cursor-pointer transition-[background,color,border-color] duration-150',
                  r === rendererType
                    ? 'bg-[rgba(40,100,200,0.35)] border-[rgba(80,140,255,0.6)] text-white'
                    : 'bg-black/55 text-white/65 border-white/[0.18] hover:bg-black/75 hover:text-white',
                ].join(' ')}
                onClick={() => setRendererType(r)}
              >
                {RENDERER_LABELS[r]}
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}
