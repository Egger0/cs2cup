import * as T from 'three'
import { random } from './terrain'
import type { Body } from './system'

export function satelliteMotion(body: Body, seconds: number) {
  for (let i = 0; i < 4; i++) {
    const drone = body.model.getObjectByName(`drone-${i}`)
    if (drone) {
      const angle = i * 1.6 + seconds * 0.035
      const pointer = body.model.userData.pointerX as number | undefined
      const avoidance =
        pointer === undefined ? 0 : Math.max(0, 0.4 - Math.abs(pointer - Math.cos(angle))) * 0.6
      drone.position.set(
        Math.cos(angle) * 1.17,
        0.3 + Math.sin(angle * 2) * 0.15 + avoidance,
        Math.sin(angle) * 1.17,
      )
    }
  }
  for (let i = 0; i < 32; i++) {
    const fragment = body.model.getObjectByName(`fragment-${i}`)
    if (!fragment) break
    const angle = random(i + 4) * Math.PI * 2 + seconds * 0.016
    fragment.position.x = Math.cos(angle) * 1.13
    fragment.position.z = Math.sin(angle) * 1.13
  }
  if (body.status === 'registration') {
    const beacon = body.root.getObjectByName('beacon')
    if (beacon) beacon.visible = Math.sin(seconds * 2.5) > -0.25
    body.root.children.forEach((child, index) => {
      if (index < 2) return
      const phase = (seconds * 0.08 + index / 12) % 1
      const radius = 0.1 + (1 - phase) * 0.35
      child.position.set(
        Math.cos(index * 2.4 + phase) * radius,
        (1 - phase) * 0.2,
        Math.sin(index * 2.4 + phase) * radius,
      )
    })
  }
  if (body.status === 'running') body.model.rotation.y = seconds * 0.3
  const laurel = body.root.getObjectByName('laurel')
  if (laurel) laurel.rotation.y = seconds * 0.4
}
export function bracketGeometry() {
  const points: T.Vector3[] = []
  for (let round = 0; round < 3; round++) {
    const count = 8 / Math.pow(2, round)
    for (let i = 0; i < count; i++) {
      const y = (i - (count - 1) / 2) * 0.09 * Math.pow(2, round)
      const next = (Math.floor(i / 2) - (count / 2 - 1) / 2) * 0.18 * Math.pow(2, round)
      points.push(
        new T.Vector3(round * 0.2 - 0.6, y, 0),
        new T.Vector3((round + 1) * 0.2 - 0.6, next, 0),
      )
    }
  }
  const geometry = new T.BufferGeometry().setFromPoints(points)
  return new T.LineSegments(
    geometry,
    new T.LineBasicMaterial({ color: '#9BCAEB', transparent: true, opacity: 0.32 }),
  )
}
