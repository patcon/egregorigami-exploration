import { useState, useRef, useCallback } from 'react'
import type { WorkerEvent } from './embeddingWorker.types'
import type { EmbeddingModelId } from './embedSegments'
import EmbeddingWorker from './embeddingWorker?worker'

export type EmbedPhase =
  | { status: 'idle' }
  | { status: 'model-loading'; progress: number }
  | { status: 'embedding'; loaded: number; total: number }
  | { status: 'umap-running' }
  | { status: 'done'; points: [number, number, number][] }
  | { status: 'error'; message: string }

export function useEmbeddingWorker() {
  const [phase, setPhase] = useState<EmbedPhase>({ status: 'idle' })
  const workerRef = useRef<Worker | null>(null)

  const getWorker = useCallback(() => {
    if (!workerRef.current) {
      const w = new EmbeddingWorker()
      w.onmessage = (e: MessageEvent<WorkerEvent>) => {
        const msg = e.data
        switch (msg.type) {
          case 'progress:model-loading':
            setPhase({ status: 'model-loading', progress: msg.progress }); break
          case 'progress:embedding':
            setPhase({ status: 'embedding', loaded: msg.loaded, total: msg.total }); break
          case 'progress:umap-running':
            setPhase({ status: 'umap-running' }); break
          case 'done':
            setPhase({ status: 'done', points: msg.points }); break
          case 'error':
            setPhase({ status: 'error', message: msg.message }); break
        }
      }
      workerRef.current = w
    }
    return workerRef.current
  }, [])

  const runEmbedding = useCallback((texts: string[], modelId: EmbeddingModelId) => {
    setPhase({ status: 'model-loading', progress: 0 })
    getWorker().postMessage({ type: 'embed', texts, modelId })
  }, [getWorker])

  const cancelEmbedding = useCallback(() => {
    workerRef.current?.terminate()
    workerRef.current = null
    setPhase({ status: 'idle' })
  }, [])

  const resetPhase = useCallback(() => {
    setPhase({ status: 'idle' })
  }, [])

  const restorePoints = useCallback((points: [number, number, number][]) => {
    setPhase({ status: 'done', points })
  }, [])

  return { phase, runEmbedding, cancelEmbedding, resetPhase, restorePoints }
}
