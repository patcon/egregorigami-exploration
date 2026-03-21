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
}

export default function YoutubePlayerEmbed({ videoId, onTimeUpdate, seekTo }: YoutubePlayerEmbedProps) {
  const containerRef = useRef<HTMLDivElement>(null)
  const playerRef = useRef<YT.Player | null>(null)
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null)
  const onTimeUpdateRef = useRef(onTimeUpdate)
  onTimeUpdateRef.current = onTimeUpdate

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
            if (event.data === window.YT.PlayerState.PLAYING) {
              startPoll(playerRef.current!)
            } else {
              stopPoll()
            }
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

  return (
    <div className="yt-player-container">
      <div className="yt-player-aspect">
        <div ref={containerRef} />
      </div>
    </div>
  )
}
