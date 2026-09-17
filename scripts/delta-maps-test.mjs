import assert from 'node:assert/strict'
import { GRID, buildField, composeRelief, kindOf, projector, samples } from './delta-map-field.mjs'
import { difficultyTable, exitsOf } from './delta-maps.mjs'

const info = { width: 50000, height: 50000, centerX: 100000, centerY: 200000 }
assert.deepEqual(projector(info)({ x: 100000, y: -200000 }), [0.5, 0.5])
assert.deepEqual(projector(info)({ x: 150000, y: -150000 }), [1, 1])
assert.deepEqual(projector(info, 90)({ x: 150000, y: -150000 }), [0, 1])
assert.deepEqual(projector(info, -90)({ x: 150000, y: -150000 }), [1, 0])

assert.equal(kindOf({ type: 'retreat', icon: 'ffcld' }), 'exit')
assert.equal(kindOf({ icon: 'boss', type: 'Boss' }), 'boss')
assert.equal(kindOf({ icon: 'csd', type: 'revive' }), 'spawn')
assert.equal(kindOf({ icon: 'tyfk' }), 'key')
assert.equal(kindOf({ icon: 'hkcwx' }), 'vault')
assert.equal(kindOf({ icon: 'yf' }), null)

const ring = Array.from({ length: 40 }, (_, index) => {
  const angle = (index / 40) * Math.PI * 2
  return {
    x: 100000 + Math.cos(angle) * 8000,
    y: -200000 + Math.sin(angle) * 8000,
    z坐标: String(-10000 + Math.cos(angle) * 3000),
    icon: index % 10 ? 'yf' : 'csd',
  }
})
const points = samples(
  [...ring, ring[0], { x: 0, y: 0, z: 0 }, { x: 1, y: 1, z: 5, catalog: 'fish' }],
  projector(info),
)
assert.equal(points.length, 40, 'drops duplicates, zero elevations and fish')
const field = buildField(points, 1000)
assert.equal(field.height.length, GRID * GRID)
assert.equal(field.relief, 59)
const [east] = field.local([0.58, 0.5])
const [west] = field.local([0.42, 0.5])
assert.ok(field.at(east, 0.5) > field.at(west, 0.5), 'east rim is higher')
assert.ok(field.mask[(GRID >> 1) * GRID + (GRID >> 1)] > 127, 'ring closes into one plate')
assert.equal(field.mask[0], 0, 'corners stay outside the plate')
assert.throws(() => buildField(points.slice(0, 5), 1000), /Too few/)
const flooded = new Uint8Array(GRID * GRID).fill(255)
const relief = composeRelief(field, new Uint8Array(GRID * GRID))
assert.ok(Math.min(...relief) >= 30, 'dry land keeps a shore above the water line')
assert.equal(Math.max(...composeRelief(field, flooded)), 0, 'water beds sit at zero')

const table = difficultyTable(`
  '00': { info: dabaInfo, nav: navList, icons: mapArticle, poi: selectRegion, name: '零号大坝', level: '常规', layer: 'map_db' },
  { info: dabaInfo, icons: dabaInfo.floorInfo.mapArticle_minus, name: '零号大坝', level: '常规', layer: 'daba_0f' },
  '10': { info: cgxgInfo, icons: mapArticle_cgxg, poi: selectRegion_cgxg, name: '长弓溪谷', level: '常规', layer: 'map_yc' },
  { info: cgxgInfo, icons: mapArticle2_cgxg, poi: selectRegion_cgxg, name: '长弓溪谷', level: '常规｜坠机事件', layer: 'map_yc2' },
`)
assert.deepEqual(
  table.get('长弓溪谷').map(entry => entry.level),
  ['常规', '常规｜坠机事件'],
)
assert.equal(table.get('零号大坝').length, 1, 'floor layers are not difficulties')

assert.deepEqual(
  exitsOf([
    {
      name: '常规',
      points: [
        ['exit', 0, 0, 0, '付费撤离点', '近A'],
        ['boss', 0, 0, 0, 'X', ''],
      ],
    },
    {
      name: '机密',
      points: [
        ['exit', 0, 0, 0, '付费撤离点', '近A'],
        ['exit', 0, 0, 0, '拉闸撤离点', '近B'],
      ],
    },
  ]),
  [
    ['付费撤离点', '近A', ''],
    ['拉闸撤离点', '近B', '机密'],
  ],
)

console.log('delta maps: ok')
