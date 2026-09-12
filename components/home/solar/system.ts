import * as T from 'three'
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js'
import type { Game, Post, Tournament } from '@/lib/types'
import { PLANET_COLORS } from '@/lib/planets'
import { arc, cube, makeTerrain, palette, random } from './terrain'
import { mapKind, planetMaps, type PlanetMaps } from './planet-maps'
import { bracketGeometry } from './satellite-motion'
import { atmosphere, convection } from './atmosphere'
import { makeEmblem } from './emblem'
import { orbitalDust } from './orbital-dust'
import { makeComet } from './comet'
import { dustField } from './dust-field'
import { surfaceMaterial } from './surface'

export interface SolarData {
  games: Game[]
  tournaments: Tournament[]
  posts: Post[]
  currentId: number | null
}
export interface Body {
  key: string
  root: T.Group
  model: T.Object3D
  radius: number
  orbit: T.Line | null
  distance: number
  index: number
  parent?: Body
  status?: string
  current?: boolean
}
export const gameColor = (game: Game) =>
  game.accentColor || PLANET_COLORS.get(game.slug) || '#7194a3'
export async function buildSystem(data: SolarData) {
  const scene = new T.Scene()
  const bodies: Body[] = []
  const star = await makeEmblem()
  scene.add(star)
  const plasma = convection()
  star.add(plasma.mesh)
  bodies.push({
    key: 'club',
    root: star,
    model: star,
    radius: 2.5,
    distance: 0,
    index: 0,
    orbit: null,
  })
  const light = new T.PointLight('#e7edf2', 64, 0, 1.25)
  light.position.set(0, 0, 0.4)
  scene.add(light)
  const stations = new T.Group()
  stations.name = 'stations'
  for (let i = 0; i < 4; i++) {
    const station = cube(0.085, palette.blue)
    const a = Math.PI / 4 + (i * Math.PI) / 2
    station.position.set(Math.cos(a) * 3.1, Math.sin(a) * 3.1, 0)
    stations.add(station)
  }
  star.add(stations)
  const maps = new Map<string, PlanetMaps>()
  await Promise.all(
    data.games.map(async game => maps.set(game.slug, await planetMaps(mapKind(game.slug)))),
  )
  data.games.forEach((game, index) => {
    const distance = 6.5 + index * 3.1
    const radius = game.slug === 'CS2' ? 1.5 : 1.13
    const root = new T.Group()
    const model = makeTerrain(game.slug, gameColor(game))
    model.scale.setScalar(radius)
    model.traverse(object => {
      if (object instanceof T.LineSegments && object.name === 'seams')
        object.material.color.set(gameColor(game)).multiplyScalar(2.2)
      if (
        object instanceof T.Mesh &&
        object.material instanceof T.MeshStandardMaterial &&
        object.material.vertexColors &&
        object.geometry.hasAttribute('uv')
      ) {
        object.material = surfaceMaterial(object.material, maps.get(game.slug)!)
      }
    })
    model.add(atmosphere(gameColor(game)))
    root.add(model)
    scene.add(root)
    const orbit = arc(distance, palette.blue)
    scene.add(orbit)
    const body: Body = { key: game.slug, root, model, radius, distance, index, orbit }
    bodies.push(body)
    const tournaments = data.tournaments
      .filter(t => t.gameId === game.id)
      .sort((a, b) => a.edition - b.edition)
    const current = tournaments.find(t => t.id === data.currentId) ?? tournaments.at(-1)
    if (game.slug === 'CS2') {
      const ring = new T.Group()
      ring.name = 'maps'
      const count = current?.mapPool.length ?? 0
      for (let i = 0; i < count; i++)
        ring.add(arc(1.4, '#a38c67', (i * Math.PI * 2) / count, ((Math.PI * 2) / count) * 0.83))
      ring.rotation.z = 0.2
      model.add(ring)
    }
    tournaments.forEach((tournament, moonIndex) => {
      const moonRoot = new T.Group()
      const current = tournament.id === data.currentId
      const moon = moonBody(
        current ? 0.22 : 0.16,
        current ? '#b9d9ef' : tournament.status === 'finished' ? '#5d6668' : '#7998ae',
        current || tournament.status === 'running',
      )
      moonRoot.add(moon)
      root.add(moonRoot)
      const distance = radius * 1.65 + moonIndex * 0.34
      const orbit = arc(distance, current ? palette.blue : '#53615e')
      root.add(orbit)
      if (tournament.status === 'registration') {
        const beacon = cube(0.045, palette.blue, true)
        beacon.name = 'beacon'
        beacon.position.set(0, 0.13, 0)
        moonRoot.add(beacon)
        for (let i = 0; i < 12; i++) {
          const dust = cube(0.012, palette.blue, true)
          dust.position.set(Math.cos(i) * 0.35, random(i) * 0.2, Math.sin(i) * 0.35)
          moonRoot.add(dust)
        }
      }
      if (tournament.status === 'postponed') {
        const beacon = cube(0.05, palette.gold, true)
        beacon.position.set(0, 0.14, 0)
        moonRoot.add(beacon)
      }
      if (tournament.status === 'running')
        moonRoot.add(arc(0.4, palette.blue, 0, 1.8), bracketGeometry())
      if (tournament.status === 'finished' && tournament.championName) moonRoot.add(laurel())
      bodies.push({
        key: `event-${tournament.slug}`,
        root: moonRoot,
        model: moon,
        radius: 0.2,
        distance,
        index: moonIndex,
        parent: body,
        orbit,
        status: tournament.status,
        current,
      })
    })
  })
  scene.add(orbitalDust())
  const dust = dustField()
  scene.add(dust)
  const grid = new T.GridHelper(60, 60, '#273331', '#202a28')
  grid.position.y = -0.65
  grid.material.transparent = true
  grid.material.opacity = 0.08
  scene.add(grid)
  const comets = data.posts.slice(0, 2).map((post, index) => {
    const comet = makeComet()
    scene.add(comet)
    return {
      root: comet,
      key: `post-${post.id}`,
      parent: bodies.find(b => b.key === data.games.find(g => g.id === post.gameId)?.slug),
      index,
    }
  })
  return { scene, bodies, comets, star, plasma, maps, dust }
}
function moonBody(size: number, color: string, glowing: boolean) {
  const moon = cube(size, color, glowing)
  moon.geometry.dispose()
  moon.geometry = new RoundedBoxGeometry(size, size, size, 3, size * 0.16)
  const edge = size * 1.06
  moon.add(
    new T.LineSegments(
      new T.EdgesGeometry(new T.BoxGeometry(edge, edge, edge)),
      new T.LineBasicMaterial({ color: palette.blue, transparent: true, opacity: 0.4 }),
    ),
  )
  return moon
}
function laurel() {
  const gold = new T.MeshStandardMaterial({
    color: '#c49a45',
    metalness: 0.85,
    roughness: 0.32,
    emissive: palette.gold,
    emissiveIntensity: 0.35,
    side: T.DoubleSide,
  })
  const crown = new T.Group()
  crown.name = 'laurel'
  const band = new T.Mesh(new T.RingGeometry(0.19, 0.215, 96), gold)
  band.rotation.x = -Math.PI / 2
  crown.add(band)
  for (let i = 0; i < 8; i++) {
    const stud = new T.Mesh(new T.BoxGeometry(0.018, 0.018, 0.018), gold)
    const angle = (i / 8) * Math.PI * 2
    stud.position.set(Math.cos(angle) * 0.2025, 0, Math.sin(angle) * 0.2025)
    stud.rotation.y = -angle
    crown.add(stud)
  }
  crown.rotation.set(0.35, 0, 0.2)
  return crown
}
export type SolarSystem = Awaited<ReturnType<typeof buildSystem>>
