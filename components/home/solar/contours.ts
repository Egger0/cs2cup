import * as T from 'three'

export function terrainContours(
  geometry: T.BufferGeometry,
  sample: (x: number, y: number, z: number) => number,
) {
  const vertices = geometry.getAttribute('position')
  const indices = geometry.index
  const heights = Array.from({ length: vertices.count }, (_, index) => {
    const point = new T.Vector3().fromBufferAttribute(vertices, index).normalize()
    return sample(point.x, point.y, point.z)
  })
  const points: T.Vector3[] = []
  const count = indices?.count ?? vertices.count
  for (let level = -0.45; level < 0.5; level += 0.12) {
    for (let offset = 0; offset < count; offset += 3) {
      const triangle = [0, 1, 2].map(corner =>
        indices ? indices.getX(offset + corner) : offset + corner,
      )
      const hits: T.Vector3[] = []
      for (let edge = 0; edge < 3; edge++) {
        const a = triangle[edge]!
        const b = triangle[(edge + 1) % 3]!
        const ha = heights[a]!
        const hb = heights[b]!
        if (ha < level === hb < level) continue
        const start = new T.Vector3().fromBufferAttribute(vertices, a)
        const end = new T.Vector3().fromBufferAttribute(vertices, b)
        hits.push(start.lerp(end, (level - ha) / (hb - ha)).multiplyScalar(1.007))
      }
      if (hits.length === 2) points.push(hits[0]!, hits[1]!)
    }
  }
  return new T.LineSegments(
    new T.BufferGeometry().setFromPoints(points),
    new T.LineBasicMaterial({ color: '#a8b991', transparent: true, opacity: 0.19 }),
  )
}
