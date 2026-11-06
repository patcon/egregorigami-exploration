import { useCallback, useEffect, useRef, useState } from 'react'
import type { WorkerEvent } from './embeddingWorker.types'
import type { EmbeddingModelId } from './embedSegments'
import EmbeddingWorker from './embeddingWorker?worker'

export type LiveStatus =
  | { status: 'idle' }
  | { status: 'model-loading'; progress: number }
  | { status: 'updating'; count: number }
  | { status: 'error'; message: string }

/**
 * Incremental embedding for the live view. Each `update(texts)` call sends the
 * full prefix of segments seen so far; the worker only embeds the new ones and
 * re-lays-out stably (warm-started UMAP + Procrustes alignment).
 *
 * At most one update is in flight; while busy, only the most recent request is
 * kept and sent once the current one finishes.
 */
export function useLiveEmbedding() {
  const [points, setPoints] = useState<[number, number, number][] | null>(null)
  const [status, setStatus] = useState<LiveStatus>({ status: 'idle' })
  const workerRef = useRef<Worker | null>(null)
  const requestIdRef = useRef(0)
  const inFlightRef = useRef<number | null>(null)
  const queuedRef = useRef<{ texts: string[]; modelId: EmbeddingModelId } | null>(null)

  const send = useCallback((worker: Worker, texts: string[], modelId: EmbeddingModelId) => {
    const requestId = ++requestIdRef.current
    inFlightRef.current = requestId
    setStatus(s => s.status === 'model-loading' ? s : { status: 'updating', count: texts.length })
    worker.postMessage({ type: 'live-update', requestId, texts, modelId })
  }, [])

  const getWorker = useCallback(() => {
    if (workerRef.current) return workerRef.current
    const w = new EmbeddingWorker()
    w.onmessage = (e: MessageEvent<WorkerEvent>) => {
      const msg = e.data
      if (msg.type === 'progress:model-loading') {
        setStatus({ status: 'model-loading', progress: msg.progress })
        return
      }
      if (msg.type !== 'live-done' && msg.type !== 'live-error') return
      if (msg.requestId !== inFlightRef.current) return // stale (from before a reset)
      inFlightRef.current = null
      if (msg.type === 'live-done') {
        setPoints(msg.points)
        setStatus({ status: 'idle' })
      } else {
        setStatus({ status: 'error', message: msg.message })
      }
      const next = queuedRef.current
      queuedRef.current = null
      if (next) send(w, next.texts, next.modelId)
    }
    workerRef.current = w
    return w
  }, [send])

  const update = useCallback((texts: string[], modelId: EmbeddingModelId) => {
    const w = getWorker()
    if (inFlightRef.current !== null) {
      queuedRef.current = { texts, modelId }
      return
    }
    send(w, texts, modelId)
  }, [getWorker, send])

  const reset = useCallback(() => {
    queuedRef.current = null
    inFlightRef.current = null
    workerRef.current?.postMessage({ type: 'live-reset' })
    setPoints(null)
    setStatus({ status: 'idle' })
  }, [])

  useEffect(() => () => { workerRef.current?.terminate(); workerRef.current = null }, [])

  return { points, status, update, reset }
}
