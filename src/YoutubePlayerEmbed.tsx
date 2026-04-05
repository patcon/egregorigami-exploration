import { useEffect, useRef } from 'react'

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
  playbackRate?: number
}

export default function YoutubePlayerEmbed({ videoId, onTimeUpdate, seekTo, playing, onPlayStateChange, playbackRate }: YoutubePlayerEmbedProps) {
  const containerRef = useRef<HTMLDivElement>(null)
  const playerRef = useRef<YT.Player | null>(null)
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null)
  const onTimeUpdateRef = useRef(onTimeUpdate)
  const onPlayStateChangeRef = useRef(onPlayStateChange)
  useEffect(() => {
    onTimeUpdateRef.current = onTimeUpdate
    onPlayStateChangeRef.current = onPlayStateChange
  })

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

      // Don't assign playerRef.current here — the object returned by new YT.Player()
      // is not fully initialized until onReady fires. Assigning it early means
      // playVideo/pauseVideo don't exist yet, causing crashes in sibling effects.
      new window.YT.Player(div, {
        videoId,
        playerVars: { rel: 0, modestbranding: 1 },
        events: {
          onReady: (event: YT.PlayerEvent) => {
            // Only expose the player once it's fully initialized
            playerRef.current = event.target
          },
          onStateChange: (event: YT.OnStateChangeEvent) => {
            if (!playerRef.current) return  // guard against post-destroy async events
            const isPlaying = event.data === window.YT.PlayerState.PLAYING
            const isPaused = event.data === window.YT.PlayerState.PAUSED
            if (isPlaying) {
              startPoll(playerRef.current)
              onPlayStateChangeRef.current?.(true)
            } else if (isPaused) {
              stopPoll()
              // Fire one update so seeks while paused still move the transcript cursor
              onTimeUpdateRef.current(playerRef.current.getCurrentTime())
              onPlayStateChangeRef.current?.(false)
            } else {
              // BUFFERING or other transient states — stop polling but don't
              // signal pause so seeks don't interrupt transcript playback
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

  // Playback rate
  useEffect(() => {
    if (playbackRate !== undefined && playerRef.current) {
      playerRef.current.setPlaybackRate(playbackRate)
    }
  }, [playbackRate])

  return (
    <div className="w-full max-w-[640px] mx-auto mb-4">
      <div className="yt-player-aspect relative w-full aspect-video">
        <div ref={containerRef} />
      </div>
    </div>
  )
}
