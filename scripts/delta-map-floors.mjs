import sharp from 'sharp'
import { sandKindOf } from '../lib/delta-sand.ts'
import { mosaic } from './delta-map-imagery.mjs'

const ORDER = code => (code.startsWith('B') ? -Number(code.slice(1)) : Number.parseInt(code, 10))

export const buildingOf = layer => layer.replace(/_(b\d|\d+f)$/i, '')

const nameOf = (catalog, building) => {
  const address = building.split('_').slice(1).join('_')
  const match = floor => (floor.floor_address ?? '') === address
  const found = Object.entries(catalog ?? {}).find(([, floors]) => [floors].flat().some(match))
  if (!found) return undefined
  return Array.isArray(catalog) ? [found[1]].flat().find(match).floor_name : found[0]
}

export function squareAround(xs, ys, margin, least) {
  const size = Math.max(
    least,
    Math.max(...xs) - Math.min(...xs) + margin * 2,
    Math.max(...ys) - Math.min(...ys) + margin * 2,
  )
  return [(Math.max(...xs) + Math.min(...xs)) / 2, (Math.max(...ys) + Math.min(...ys)) / 2, size]
}

export async function buildFloors({
  entries,
  globals,
  zoom,
  catalog,
  project,
  field,
  regions,
  write,
}) {
  const groups = new Map()
  entries.forEach((entry, level) => {
    for (const floor of entry.floors ?? []) {
      const building = buildingOf(floor.layer)
      const group = groups.get(building) ?? { layers: new Map(), items: [] }
      group.layers.set(floor.code, floor.layer)
      for (const item of globals[floor.icons] ?? []) {
        if (!sandKindOf(item)) continue
        group.items.push({ level, code: floor.code, item })
      }
      groups.set(building, group)
    }
  })
  const buildings = []
  const points = entries.map(() => [])
  for (const [key, group] of groups) {
    const placed = group.items
      .map(entry => ({ ...entry, at: field.local(project(entry.item)) }))
      .filter(({ at: [x, y] }) => x > 0 && y > 0 && x < 1 && y < 1)
    if (!placed.length) continue
    const [x, y] = squareAround(
      placed.map(entry => entry.at[0]),
      placed.map(entry => entry.at[1]),
      0,
      0,
    )
    const index = buildings.length
    const name =
      nameOf(catalog, key) ??
      regions.reduce((best, region) =>
        Math.hypot(region[1] - x, region[2] - y) < Math.hypot(best[1] - x, best[2] - y)
          ? region
          : best,
      )[0]
    const floors = [...group.layers.keys()].sort((a, b) => ORDER(a) - ORDER(b))
    const world = 512 * 2 ** (zoom - 1)
    const frames = []
    for (const code of floors) {
      const own = placed.filter(entry => entry.code === code)
      const sample = own.length ? own : placed
      const frame = squareAround(
        sample.map(entry => entry.at[0]),
        sample.map(entry => entry.at[1]),
        30 / field.meters,
        90 / field.meters,
      )
      const probe = [
        field.origin[0] + (frame[0] - frame[2] / 2) * field.side,
        field.origin[1] + (frame[1] - frame[2] / 2) * field.side,
        frame[2] * field.side,
      ]
      const canvas = await mosaic({
        layer: group.layers.get(code),
        zoom,
        tile: 512,
        world,
        frame: probe,
        required: 0.3,
      })
      const width = Math.min(2048, Math.round(probe[2] * world))
      await write(
        index,
        code,
        await sharp(canvas).resize(width, width).webp({ quality: 80 }).toBuffer(),
      )
      frames.push(frame.map(value => +value.toFixed(4)))
    }
    buildings.push({ name, x: +x.toFixed(4), y: +y.toFixed(4), floors, frames })
    for (const entry of placed)
      points[entry.level].push({ ...entry, floor: `${index}:${entry.code}` })
  }
  return { buildings, points }
}
