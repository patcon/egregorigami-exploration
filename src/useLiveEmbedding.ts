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
 * Never starts an update while the worker is still running one (layout time
 * grows with transcript length). While busy, only the most recent request is
 * kept and sent as soon as the worker frees up, so updates run back-to-back
 * and each one covers everything that arrived in the meantime.
 */
export function useLiveEmbedding() {
  const [points, setPoints] = useState<[number, number, number][] | null>(null)
  const [status, setStatus] = useState<LiveStatus>({ status: 'idle' })
  const workerRef = useRef<Worker | null>(null)
  const requestIdRef = useRef(0)
  /** Request id whose result we still want (null after a reset). */
  const inFlightRef = useRef<number | null>(null)
  /** Whether the worker is running a live update — stays true after a reset until it finishes. */
  const busyRef = useRef(false)
  const queuedRef = useRef<{ texts: string[]; modelId: EmbeddingModelId } | null>(null)

  const send = useCallback((worker: Worker, texts: string[], modelId: EmbeddingModelId) => {
    const requestId = ++requestIdRef.current
    inFlightRef.current = requestId
    busyRef.current = true
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
      busyRef.current = false
      if (msg.requestId === inFlightRef.current) {
        inFlightRef.current = null
        if (msg.type === 'live-done') {
          setPoints(msg.points)
          setStatus({ status: 'idle' })
        } else {
          setStatus({ status: 'error', message: msg.message })
        }
      } // else: stale result from before a reset — drop it, but the worker is free now
      const next = queuedRef.current
      queuedRef.current = null
      if (next) send(w, next.texts, next.modelId)
    }
    workerRef.current = w
    return w
  }, [send])

  const update = useCallback((texts: string[], modelId: EmbeddingModelId) => {
    const w = getWorker()
    if (busyRef.current) {
      queuedRef.current = { texts, modelId }
      return
    }
    send(w, texts, modelId)
  }, [getWorker, send])

  const reset = useCallback(() => {
    queuedRef.current = null
    inFlightRef.current = null // busyRef stays as-is: a running job still blocks new sends
    workerRef.current?.postMessage({ type: 'live-reset' })
    setPoints(null)
    setStatus({ status: 'idle' })
  }, [])

  useEffect(() => () => { workerRef.current?.terminate(); workerRef.current = null; busyRef.current = false }, [])

  return { points, status, update, reset }
}
