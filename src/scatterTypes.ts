export type FollowMode = 'static' | 'tracking' | 'following'

export interface CameraState {
  position: [number, number, number]
  target: [number, number, number]
  followMode: FollowMode
}
