import * as T from 'three'

export function crystalPanels(source: T.BufferGeometry, accent: string) {
  const input = source.getAttribute('position')
  const positions: number[] = []
  const colors: number[] = []
  const base = new T.Color(accent)
  const triangle = (a: T.Vector3, b: T.Vector3, c: T.Vector3, shade: number) => {
    for (const point of [a, b, c]) {
      positions.push(...point.toArray())
      colors.push(base.r * shade, base.g * shade, base.b * shade)
    }
  }
  for (let i = 0; i < input.count; i += 3) {
    if (i % 9 !== 0) continue
    const outer = [0, 1, 2].map(n => new T.Vector3().fromBufferAttribute(input, i + n))
    const center = outer
      .reduce((sum, point) => sum.add(point), new T.Vector3())
      .multiplyScalar(1 / 3)
    const normal = center.clone().normalize()
    const rim = outer.map(point => point.clone().lerp(center, 0.14).addScaledVector(normal, 0.003))
    const top = rim.map(point => point.clone().lerp(center, 0.08).addScaledVector(normal, 0.009))
    triangle(top[0]!, top[1]!, top[2]!, 0.83)
    for (let edge = 0; edge < 3; edge++) {
      const next = (edge + 1) % 3
      triangle(rim[edge]!, rim[next]!, top[next]!, 1.2)
      triangle(rim[edge]!, top[next]!, top[edge]!, 1.2)
    }
  }
  const geometry = new T.BufferGeometry()
  geometry.setAttribute('position', new T.Float32BufferAttribute(positions, 3))
  geometry.setAttribute('color', new T.Float32BufferAttribute(colors, 3))
  geometry.computeVertexNormals()
  const mesh = new T.Mesh(
    geometry,
    new T.MeshStandardMaterial({ vertexColors: true, metalness: 0.65, roughness: 0.36 }),
  )
  mesh.name = 'crystal-panels'
  return mesh
}
