import * as T from 'three'

export function settlements(sample: (n: number) => number) {
  const detail = new T.Group()
  detail.name = 'settlements'
  const materials = {
    stone: new T.MeshStandardMaterial({ color: '#89785e', roughness: 0.92 }),
    roof: new T.MeshStandardMaterial({ color: '#b5a17a', roughness: 0.86 }),
    metal: new T.MeshStandardMaterial({ color: '#50616a', roughness: 0.48, metalness: 0.65 }),
    road: new T.MeshStandardMaterial({ color: '#494338', roughness: 1 }),
    light: new T.MeshStandardMaterial({
      color: '#9BCAEB',
      emissive: '#9BCAEB',
      emissiveIntensity: 0.5,
      roughness: 0.55,
    }),
  }
  const block = (
    x: number,
    y: number,
    z: number,
    w: number,
    h: number,
    d: number,
    material: T.Material,
  ) => {
    const mesh = new T.Mesh(new T.BoxGeometry(w, h, d), material)
    mesh.position.set(x, y + h / 2, z)
    return mesh
  }
  for (let index = 0; index < 6; index++) {
    const latitude = 0.62 - (index / 5) * 1.24
    const angle = index * 2.39996 + 0.65
    const ring = Math.sqrt(1 - latitude * latitude)
    const town = new T.Group()
    town.position
      .set(Math.cos(angle) * ring, latitude, Math.sin(angle) * ring)
      .multiplyScalar(1.004)
    town.quaternion.setFromUnitVectors(new T.Vector3(0, 1, 0), town.position.clone().normalize())
    town.scale.setScalar(0.5)
    town.add(block(0, -0.005, 0, 0.35, 0.006, 0.33, materials.stone))
    const pad = block(0, 0.003, 0, 0.105, 0.003, 0.105, materials.metal)
    pad.name = `landing-${index}`
    pad.material = materials.light.clone()
    town.add(pad)
    for (const sign of [-1, 1]) {
      town.add(block(sign * 0.061, 0.004, 0, 0.004, 0.003, 0.124, materials.light))
      town.add(block(0, 0.004, sign * 0.061, 0.124, 0.003, 0.004, materials.light))
      town.add(block(sign * 0.085, 0.002, 0, 0.013, 0.001, 0.32, materials.road))
      town.add(block(0, 0.002, sign * 0.085, 0.34, 0.001, 0.013, materials.road))
    }
    for (let i = 0; i < 52; i++) {
      const a = i * 2.39996 + index
      const radius = 0.112 + sample(i + 80) * 0.047
      const x = Math.cos(a) * radius
      const z = Math.sin(a) * radius
      const w = 0.012 + sample(i) * 0.012
      const d = 0.013 + sample(i + 10) * 0.011
      const h = 0.008 + sample(i + 20) * 0.027
      if (Math.abs(Math.abs(x) - 0.085) < 0.015 || Math.abs(Math.abs(z) - 0.085) < 0.015) continue
      town.add(block(x, 0.002, z, w, h, d, materials.stone))
      town.add(block(x, h + 0.002, z, w * 1.09, 0.003, d * 1.09, materials.roof))
      town.add(block(x - w * 0.2, h + 0.005, z, w * 0.3, 0.003, d * 0.35, materials.metal))
      if (i % 3 === 0)
        town.add(block(x, h * 0.4, z + d / 2 + 0.001, w * 0.4, 0.002, 0.001, materials.light))
    }
    detail.add(town)
  }
  return detail
}
