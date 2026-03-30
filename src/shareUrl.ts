import { deflate, inflate } from 'pako'

export interface SharePayload {
  windowSize: number
  overlapPct: number
  videoId?: string
  modelId?: string
  rendererType?: string
  rawText?: string
  points?: [number, number, number][]
}

export function encodeSharePayload(payload: SharePayload): string {
  const json = JSON.stringify(payload)
  const compressed = deflate(json)
  // btoa requires a binary string; convert Uint8Array via charCodeAt
  return btoa(String.fromCharCode(...compressed))
}

export function decodeSharePayload(encoded: string): SharePayload {
  const binary = atob(encoded)
  const bytes = Uint8Array.from(binary, c => c.charCodeAt(0))
  const json = inflate(bytes, { to: 'string' })
  return JSON.parse(json) as SharePayload
}

export function buildShareUrl(payload: SharePayload, hash: string): string {
  const encoded = encodeSharePayload(payload)
  const url = new URL(window.location.href)
  url.hash = hash
  url.searchParams.set('share', encoded)
  // Remove videoId param if present — share payload contains all needed state
  url.searchParams.delete('videoId')
  return url.toString()
}

export function readShareParam(): SharePayload | null {
  const encoded = new URLSearchParams(window.location.search).get('share')
  if (!encoded) return null
  try {
    return decodeSharePayload(encoded)
  } catch {
    return null
  }
}
