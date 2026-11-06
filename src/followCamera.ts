import * as THREE from 'three'

// Fraction of the remaining angle the camera's heading closes each frame.
// Low enough that a sharp turn in the path reads as a swing, not a cut.
const SWING_RATE = 0.04

const _q = new THREE.Quaternion()
const _identity = new THREE.Quaternion()

/**
 * Ease the follow camera's heading toward the path's current direction.
 *
 * `heading` is the camera's smoothed sense of "forward" (mutated in place).
 * `offset` (camera position minus target) is rotated by the same partial
 * rotation, so the camera orbits around the target as the heading catches up
 * rather than snapping behind the cursor whenever the path bends.
 */
export function swingFollowCamera(offset: THREE.Vector3, heading: THREE.Vector3, pathTangent: THREE.Vector3) {
  if (heading.lengthSq() === 0) {
    heading.copy(pathTangent)
    return
  }
  if (heading.dot(pathTangent) > 0.99999) return
  _q.setFromUnitVectors(heading, pathTangent)
  _identity.identity().slerp(_q, SWING_RATE)
  offset.applyQuaternion(_identity)
  heading.applyQuaternion(_identity).normalize()
}
