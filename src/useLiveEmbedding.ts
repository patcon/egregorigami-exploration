import { useCallback, useEffect, useRef, useState } from 'react'
import type { WorkerEvent } from './embeddingWorker.types'
import type { EmbeddingModelId } from './embedSegments'
import type { UmapMetric } from './umapMetric'
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
 * grows with transcript length). Only the latest requested prefix is kept, and
 * the worker is fed as soon as it frees up. A large backlog (e.g. after jumping
 * ahead on the timeline) is sent in batches of MAX_BATCH new segments, so the
 * view appears quickly and visibly catches up instead of blocking on one huge job.
 */
const MAX_BATCH = 20

export function useLiveEmbedding() {
  const [points, setPoints] = useState<[number, number, number][] | null>(null)
  const [status, setStatus] = useState<LiveStatus>({ status: 'idle' })
  const workerRef = useRef<Worker | null>(null)
  const requestIdRef = useRef(0)
  /** Request id whose result we still want (null after a reset). */
  const inFlightRef = useRef<number | null>(null)
  /** Whether the worker is running a live update — stays true after a reset until it finishes. */
  const busyRef = useRef(false)
  /** Latest prefix of segments the view wants laid out. */
  const targetRef = useRef<{ texts: string[]; modelId: EmbeddingModelId; metric: UmapMetric } | null>(null)
  /** How many segments the in-flight (or last completed) request covered. */
  const sentCountRef = useRef(0)

  /** If the worker is free and the target is ahead of what's been sent, send the next batch. */
  const pump = useCallback((worker: Worker) => {
    const target = targetRef.current
    if (busyRef.current || !target) return
    const n = Math.min(target.texts.length, sentCountRef.current + MAX_BATCH)
    if (n <= sentCountRef.current) return
    const requestId = ++requestIdRef.current
    inFlightRef.current = requestId
    busyRef.current = true
    sentCountRef.current = n
    setStatus(s => s.status === 'model-loading' ? s : { status: 'updating', count: n })
    worker.postMessage({ type: 'live-update', requestId, texts: target.texts.slice(0, n), modelId: target.modelId, metric: target.metric })
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
      pump(w)
    }
    workerRef.current = w
    return w
  }, [pump])

  const update = useCallback((texts: string[], modelId: EmbeddingModelId, metric: UmapMetric) => {
    targetRef.current = { texts, modelId, metric }
    pump(getWorker())
  }, [getWorker, pump])

  const reset = useCallback(() => {
    targetRef.current = null
    sentCountRef.current = 0
    inFlightRef.current = null // busyRef stays as-is: a running job still blocks new sends
    workerRef.current?.postMessage({ type: 'live-reset' })
    setPoints(null)
    setStatus({ status: 'idle' })
  }, [])

  useEffect(() => () => { workerRef.current?.terminate(); workerRef.current = null; busyRef.current = false }, [])

  return { points, status, update, reset }
}
