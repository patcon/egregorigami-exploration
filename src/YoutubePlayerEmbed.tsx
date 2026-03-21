import { useEffect, useRef } from 'react'
import './YoutubePlayerEmbed.css'

declare global {
  interface Window {
    onYouTubeIframeAPIReady: (() => void) | undefined
  }
}


interface YoutubePlayerEmbedProps {
  videoId: string
  onTimeUpdate: (seconds: number) => void
  seekTo?: number
  playing?: boolean
  onPlayStateChange?: (playing: boolean) => void
}

export default function YoutubePlayerEmbed({ videoId, onTimeUpdate, seekTo, playing, onPlayStateChange }: YoutubePlayerEmbedProps) {
  const containerRef = useRef<HTMLDivElement>(null)
  const playerRef = useRef<YT.Player | null>(null)
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null)
  const onTimeUpdateRef = useRef(onTimeUpdate)
  onTimeUpdateRef.current = onTimeUpdate
  const onPlayStateChangeRef = useRef(onPlayStateChange)
  onPlayStateChangeRef.current = onPlayStateChange

  // Load YT IFrame API once
  useEffect(() => {
    if (!document.getElementById('yt-iframe-api')) {
      const tag = document.createElement('script')
      tag.id = 'yt-iframe-api'
      tag.src = 'https://www.youtube.com/iframe_api'
      document.head.appendChild(tag)
    }
  }, [])

  // Create/recreate player when videoId changes
  useEffect(() => {
    if (!containerRef.current) return

    const startPoll = (player: YT.Player) => {
      pollRef.current = setInterval(() => {
        if (player.getPlayerState() === window.YT?.PlayerState?.PLAYING) {
          onTimeUpdateRef.current(player.getCurrentTime())
        }
      }, 250)
    }

    const stopPoll = () => {
      if (pollRef.current !== null) {
        clearInterval(pollRef.current)
        pollRef.current = null
      }
    }

    const createPlayer = () => {
      if (!containerRef.current) return
      const div = document.createElement('div')
      containerRef.current.innerHTML = ''
      containerRef.current.appendChild(div)

      playerRef.current = new window.YT.Player(div, {
        videoId,
        playerVars: { rel: 0, modestbranding: 1 },
        events: {
          onStateChange: (event: YT.OnStateChangeEvent) => {
            const isPlaying = event.data === window.YT.PlayerState.PLAYING
            if (isPlaying) {
              startPoll(playerRef.current!)
            } else {
              stopPoll()
              // Fire one update so seeks while paused still move the transcript cursor
              onTimeUpdateRef.current(playerRef.current!.getCurrentTime())
            }
            onPlayStateChangeRef.current?.(isPlaying)
          },
        },
      })
    }

    if (window.YT?.Player) {
      // API already loaded
      if (playerRef.current) {
        playerRef.current.destroy()
        playerRef.current = null
      }
      stopPoll()
      createPlayer()
    } else {
      // Queue for when API loads
      const prev = window.onYouTubeIframeAPIReady
      window.onYouTubeIframeAPIReady = () => {
        prev?.()
        if (playerRef.current) {
          playerRef.current.destroy()
          playerRef.current = null
        }
        stopPoll()
        createPlayer()
      }
    }

    return () => {
      stopPoll()
      if (playerRef.current) {
        playerRef.current.destroy()
        playerRef.current = null
      }
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [videoId])

  // Seek when seekTo changes
  useEffect(() => {
    if (seekTo !== undefined && playerRef.current) {
      playerRef.current.seekTo(seekTo, true)
    }
  }, [seekTo])

  // Play/pause driven by transcript controls
  useEffect(() => {
    if (playing === undefined || !playerRef.current) return
    if (playing) playerRef.current.playVideo()
    else playerRef.current.pauseVideo()
  }, [playing])

  return (
    <div className="yt-player-container">
      <div className="yt-player-aspect">
        <div ref={containerRef} />
      </div>
    </div>
  )
}
