import * as T from 'three'

const DAY = { sky: '#9bcaeb', ground: '#0b0c0b', hemisphere: 1.1, sun: '#ffe9c4', intensity: 2.6 }
const NIGHT = {
  sky: '#4a6a9c',
  ground: '#06080c',
  hemisphere: 0.85,
  sun: '#a9c1ff',
  intensity: 1.6,
}

export function createLighting(scene: T.Scene) {
  const hemisphere = new T.HemisphereLight()
  const sun = new T.DirectionalLight()
  sun.position.set(-2.2, 1.6, -1.2)
  scene.add(hemisphere, sun)
  const apply = (night: boolean) => {
    const preset = night ? NIGHT : DAY
    hemisphere.color.set(preset.sky)
    hemisphere.groundColor.set(preset.ground)
    hemisphere.intensity = preset.hemisphere
    sun.color.set(preset.sun)
    sun.intensity = preset.intensity
    scene.fog = night ? new T.FogExp2('#05070c', 0.12) : new T.FogExp2('#06070a', 0.06)
  }
  apply(false)
  return apply
}
