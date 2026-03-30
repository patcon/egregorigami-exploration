import { useEffect } from 'react'
import type { MutableRefObject, Dispatch, SetStateAction } from 'react'

export function useVideoKeyboardControls(
  videoTimeRef: MutableRefObject<number>,
  setVideoTime: (t: number) => void,
  setSeekTarget: (t: number) => void,
  setYtPlaying: Dispatch<SetStateAction<boolean>>,
) {
  useEffect(() => {
    const SEEK_DELTA = 10
    const handler = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement
      if (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.isContentEditable) return
      if (e.key === ' ') {
        e.preventDefault()
        setYtPlaying(p => !p)
      } else if (e.key === 'ArrowRight') {
        e.preventDefault()
        const newT = videoTimeRef.current + SEEK_DELTA
        setVideoTime(newT)
        setSeekTarget(newT)
      } else if (e.key === 'ArrowLeft') {
        e.preventDefault()
        const newT = Math.max(0, videoTimeRef.current - SEEK_DELTA)
        setVideoTime(newT)
        setSeekTarget(newT)
      }
    }
    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, []) // eslint-disable-line react-hooks/exhaustive-deps
}
