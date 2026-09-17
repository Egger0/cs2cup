import { mkdir, writeFile } from 'node:fs/promises'
import { chromium } from 'playwright'
import { buildImagery } from './delta-map-imagery.mjs'
import { createIconAtlas } from './delta-map-icons.mjs'
import { sandKindOf } from '../lib/delta-sand.ts'
import { GRID, buildField, composeRelief, projector, samples } from './delta-map-field.mjs'
import { buildFloors } from './delta-map-floors.mjs'

const SOURCE = 'https://game.gtimg.cn/images/dfm/cp/a20240729directory/js/lib/'
const SCRIPTS = [
  'daba_floor',
  'cgxg_floor',
  'bks_floor',
  'cxjy_floor',
  'az3_floor',
  'map_article',
  'map_cgxg',
  'map_htjd',
  'map_bks',
  'map_cxjy',
  'map_az3',
]
const MAPS = [
  { id: 'zero-dam', name: '零号大坝', en: 'Zero Dam' },
  { id: 'layali-grove', name: '长弓溪谷', en: 'Layali Grove' },
  { id: 'space-city', name: '航天基地', en: 'Space City' },
  { id: 'brakkesh', name: '巴克什', en: 'Brakkesh' },
  { id: 'tide-prison', name: '潮汐监狱', en: 'Tide Prison' },
  { id: 'az3', name: 'AZ3', en: 'AZ3' },
]
const OUTPUT = new URL('../public/games/delta/maps/', import.meta.url)

const ascii = value =>
  JSON.stringify(value).replace(
    /[^\x20-\x7e]/g,
    char => `\\u${char.charCodeAt(0).toString(16).padStart(4, '0')}`,
  )

const download = async name => {
  const response = await fetch(`${SOURCE}${name}.js`)
  if (!response.ok) throw new Error(`${name}.js answered ${response.status}`)
  return response.text()
}

export function difficultyTable(main) {
  const table = new Map()
  const byKey = new Map()
  for (const [, key, raw] of main.matchAll(/'(\d{2}(?:_\w+)?)':\s*\{([^{}]*)\}/g)) {
    const body = raw.replace(/^\s*\/\/.*$/gm, '')
    const field = name => body.match(new RegExp(`\\b${name}: ['"]?([^'",\\n]+)`))?.[1]?.trim()
    const [info, icons, regions, name, level, layer] = [
      'info',
      'icons',
      'poi',
      'name',
      'level',
      'layer',
    ].map(field)
    if (!info || !icons || !level || !layer) continue
    if (icons.includes('.floorInfo.')) {
      const segments = key.split('_')
      const parent = segments
        .slice(1, -1)
        .map((_, index, rest) => [segments[0], ...rest.slice(0, rest.length - index)].join('_'))
        .concat(segments[0])
        .find(candidate => byKey.has(candidate))
      const own = layer.match(/_(\d+f|b\d)$/i)?.[1]
      const code = (segments.length > 2 && own ? own : segments.at(-1)).toUpperCase()
      byKey.get(parent)?.floors.push({ icons, layer, code: code === '0F' ? 'B1' : code })
      continue
    }
    const entries = table.get(name) ?? []
    const entry = entries.find(other => other.icons === icons) ?? {
      info,
      icons,
      regions,
      level,
      layer,
      floors: [],
    }
    if (!entries.includes(entry)) entries.push(entry)
    byKey.set(key, entry)
    table.set(name, entries)
  }
  for (const entries of table.values())
    for (const entry of entries)
      entry.floors = entry.floors.filter(
        (floor, index, all) =>
          all.findIndex(other => other.layer === floor.layer && other.code === floor.code) ===
          index,
      )
  return table
}

async function evaluate(sources, names) {
  const browser = await chromium.launch()
  try {
    const page = await browser.newPage({ javaScriptEnabled: true })
    await page.route('**/*', route => route.abort())
    await page.setContent('<!doctype html><title>sandbox</title>')
    for (const source of sources) await page.addScriptTag({ content: source })
    return await page.evaluate(
      list => Object.fromEntries(list.map(name => [name, globalThis.eval(name)])),
      names,
    )
  } finally {
    await browser.close()
  }
}

const pointOf = (item, project, field, regions, atlas, floor) => {
  const [x, y] = field.local(project(item))
  const near = regions.reduce((best, region) =>
    Math.hypot(region[1] - x, region[2] - y) < Math.hypot(best[1] - x, best[2] - y) ? region : best,
  )
  const storey = /^-?\d+$/.test(item.floor ?? '') ? `${item.floor}F` : item.floor
  const note = [
    item['大区域'] && !item['大区域'].includes('_') ? item['大区域'] : `近${near[0]}`,
    item.sub_name,
    item['撤离条件'],
    item['拾取条件'],
    item['随机'] ?? item['出现条件'],
    floor ? null : storey,
  ]
    .filter(Boolean)
    .join(' · ')
  const link = [item.point1, item.point2]
    .filter(Boolean)
    .flatMap(point => field.local(project(point)).map(value => +value.toFixed(4)))
  const icon = atlas.indexOf(item.icon?.replace(/^nav_/, ''))
  const point = [sandKindOf(item), +x.toFixed(4), +y.toFixed(4), item.name, note, icon]
  if (floor || link.length) point.push(floor ?? '')
  if (link.length) point.push(link)
  return point
}

export function exitsOf(levels) {
  const found = new Map()
  for (const level of levels)
    for (const [kind, , , label, note, , floor] of level.points) {
      if (floor) continue
      if (kind !== 'exit') continue
      const key = `${label}\u0000${note}`
      found.set(key, new Set([...(found.get(key) ?? []), level.name]))
    }
  return [...found].map(([key, names]) => [
    ...key.split('\u0000'),
    names.size === levels.length ? '' : [...names].join(' · '),
  ])
}

async function main() {
  const [mainSource, ...sources] = await Promise.all(['main', ...SCRIPTS].map(download))
  const table = difficultyTable(mainSource)
  const wanted = MAPS.flatMap(map => {
    const entries = table.get(map.name)
    if (!entries?.length) throw new Error(`No difficulty entries for ${map.name}`)
    return entries.flatMap(entry =>
      [
        entry.info,
        entry.icons,
        entry.regions,
        `${entry.info}.floorInfo?.info?.maxZomm`,
        `${entry.info}.floorInfo?.info?.floor`,
        ...entry.floors.map(floor => floor.icons),
      ].filter(Boolean),
    )
  })
  const globals = await evaluate(sources, [...new Set(wanted)])
  await mkdir(OUTPUT, { recursive: true })
  const summary = []
  const atlas = createIconAtlas()
  for (const map of MAPS) {
    const entries = table.get(map.name)
    const info = globals[entries[0].info]
    const turn = /map_yc/.test(entries[0].layer ?? '') ? 90 : (info.rotate ?? 0)
    const project = projector(info, turn)
    const meters = (info.width * 2) / 100
    const items = entries.flatMap(entry => globals[entry.icons])
    const field = buildField(
      samples(items, project),
      meters,
      items.filter(sandKindOf).map(item => {
        const [u, v] = project(item)
        return { u, v }
      }),
    )
    const regions = (globals[entries[0].regions] ?? [])
      .filter((region, index, all) => all.findIndex(other => other.name === region.name) === index)
      .map(region => {
        const [x, y] = field.local(project(region))
        return [region.name, +x.toFixed(4), +y.toFixed(4), +field.at(x, y).toFixed(3)]
      })
    const floors = await buildFloors({
      entries,
      globals,
      zoom: (globals[`${entries[0].info}.floorInfo?.info?.maxZomm`] ?? 6) - 1,
      catalog: globals[`${entries[0].info}.floorInfo?.info?.floor`],
      project,
      field,
      regions,
      write: (building, code, image) =>
        writeFile(new URL(`${map.id}-b${building}-${code.toLowerCase()}.webp`, OUTPUT), image),
    })
    const levels = entries.map((entry, level) => ({
      name: entry.level,
      points: [
        ...globals[entry.icons]
          .filter(sandKindOf)
          .map(item => pointOf(item, project, field, regions, atlas)),
        ...floors.points[level].map(({ item, floor }) =>
          pointOf(item, project, field, regions, atlas, floor),
        ),
      ].filter(([, x, y]) => x > 0 && y > 0 && x < 1 && y < 1),
    }))
    const { water, detail } = await buildImagery(
      entries[0].layer,
      [...field.origin, field.side],
      GRID,
      (width, image) => writeFile(new URL(`${map.id}-${width}.webp`, OUTPUT), image),
    )
    const data = {
      id: map.id,
      name: map.name,
      meters: field.meters,
      relief: field.relief,
      grid: GRID,
      detail,
      height: Buffer.from(composeRelief(field, water)).toString('base64'),
      mask: Buffer.from(field.mask).toString('base64'),
      regions,
      buildings: floors.buildings,
      levels,
    }
    await writeFile(new URL(`${map.id}.json`, OUTPUT), ascii(data))
    summary.push({
      ...map,
      meters: field.meters,
      relief: field.relief,
      areas: regions.map(([name]) => name).join(' · '),
      levels: levels.map(level => level.name),
      bosses: [
        ...new Set(levels.flatMap(level => level.points.filter(([kind]) => kind === 'boss'))),
      ]
        .map(point => point[3])
        .filter((name, index, all) => all.indexOf(name) === index)
        .join('、'),
      exits: exitsOf(levels),
    })
    console.log(
      `${map.name}: ${field.meters} m, ${levels.length} difficulties, ${regions.length} areas`,
    )
  }
  await writeFile(new URL('icons.webp', OUTPUT), await atlas.render())
  await writeFile(
    new URL('../lib/delta-map-summaries.ts', import.meta.url),
    `import type { DeltaMapSummary } from './delta-sand'\n\nexport const DELTA_MAP_SUMMARIES: DeltaMapSummary[] = ${JSON.stringify(summary)}\n`,
  )
}

if (import.meta.url === `file://${process.argv[1]}`) await main()
