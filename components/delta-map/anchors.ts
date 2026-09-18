import * as T from 'three'

export interface Box {
  x: number
  y: number
  width: number
  height: number
}

const overlaps = (a: Box, b: Box) =>
  a.x < b.x + b.width + 6 &&
  b.x < a.x + a.width + 6 &&
  a.y < b.y + b.height + 4 &&
  b.y < a.y + a.height + 4

const set = (element: HTMLElement, name: string, value: string) => {
  if (element.style.getPropertyValue(name) !== value) element.style.setProperty(name, value)
}

export function placeAnchors(
  overlay: HTMLElement,
  locate: (element: HTMLElement) => T.Vector3 | null,
  world: T.Object3D,
  camera: T.Camera,
  width: number,
  height: number,
  ready: boolean,
) {
  const anchors = [...overlay.querySelectorAll<HTMLElement>('[data-sand-anchor]')]
  const placed: Box[] = []
  const ranked = anchors
    .map(element => {
      const local = locate(element)
      const projected = local ? world.localToWorld(local).project(camera) : new T.Vector3(0, 0, 2)
      return {
        element,
        priority: Number(element.dataset.priority ?? 0),
        depth: projected.z,
        sx: (projected.x * 0.5 + 0.5) * width,
        sy: (-projected.y * 0.5 + 0.5) * height,
      }
    })
    .sort((a, b) => b.priority - a.priority || a.depth - b.depth)
  for (const anchor of ranked) {
    const { element } = anchor
    const box = {
      x: anchor.sx - element.offsetWidth / 2,
      y: anchor.sy - element.offsetHeight,
      width: element.offsetWidth,
      height: element.offsetHeight,
    }
    const onScreen =
      anchor.depth < 1 &&
      box.x > 4 &&
      box.y > 4 &&
      box.x + box.width < width - 4 &&
      anchor.sy < height - 4
    const visible =
      ready && onScreen && (anchor.priority > 0 || placed.every(other => !overlaps(box, other)))
    if (visible) placed.push(box)
    set(element, '--sx', `${Math.round(anchor.sx)}px`)
    set(element, '--sy', `${Math.round(anchor.sy)}px`)
    if (element.dataset.visible !== String(visible)) element.dataset.visible = String(visible)
  }
  return placed
}
