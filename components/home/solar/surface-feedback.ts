import * as T from 'three'

export function surfaceFeedback(model: T.Object3D, raycaster: T.Raycaster) {
  const hit = raycaster.intersectObject(model, true).find(item => {
    if (!(item.object instanceof T.Mesh)) return false
    return item.object.material instanceof T.MeshStandardMaterial
  })
  model.traverse(object => {
    if (!object.name.startsWith('landing-') || !(object instanceof T.Mesh)) return
    const material = object.material
    if (material instanceof T.MeshStandardMaterial)
      material.emissiveIntensity = hit?.object === object ? 1.65 : 0.5
  })
  const seams = model.getObjectByName('seams')
  if (!(seams instanceof T.LineSegments) || !(seams.material instanceof T.LineBasicMaterial)) return
  const positions = seams.geometry.getAttribute('position')
  let colors = seams.geometry.getAttribute('color')
  if (!colors) {
    colors = new T.Float32BufferAttribute(new Float32Array(positions.count * 3), 3)
    seams.geometry.setAttribute('color', colors)
    seams.material.vertexColors = true
    seams.material.opacity = 0.85
    seams.material.needsUpdate = true
  }
  const point = hit ? seams.worldToLocal(hit.point.clone()) : null
  const size = seams.getWorldScale(new T.Vector3()).length() / Math.sqrt(3)
  const vertex = new T.Vector3()
  for (let index = 0; index < positions.count; index++) {
    vertex.fromBufferAttribute(positions, index)
    const proximity = point ? Math.max(0, 1 - vertex.distanceTo(point) * size * 3.5) : 0
    const brightness = 0.2 + proximity * proximity * 0.8
    colors.setXYZ(index, brightness, brightness, brightness)
  }
  colors.needsUpdate = true
}
