import assert from 'node:assert/strict'
import { sandIconOf, sandKindOf } from '../lib/delta-sand.ts'
import { GRID, buildField, composeRelief, projector, samples } from './delta-map-field.mjs'
import { buildingOf } from './delta-map-floors.mjs'
import { inlineIcon } from './delta-map-icons.mjs'
import { difficultyTable, exitsOf } from './delta-maps.mjs'

const info = { width: 50000, height: 50000, centerX: 100000, centerY: 200000 }
assert.deepEqual(projector(info)({ x: 100000, y: -200000 }), [0.5, 0.5])
assert.deepEqual(projector(info)({ x: 150000, y: -150000 }), [1, 1])
assert.deepEqual(projector(info, 90)({ x: 150000, y: -150000 }), [0, 1])
assert.deepEqual(projector(info, -90)({ x: 150000, y: -150000 }), [1, 0])

assert.equal(sandKindOf({ type: 'retreat', icon: 'ffcld' }), 'exit')
assert.equal(sandKindOf({ icon: 'boss', type: 'Boss' }), 'boss')
assert.equal(sandKindOf({ icon: 'csd', type: 'revive' }), 'spawn')
assert.equal(sandKindOf({ icon: 'tyfk' }), 'key')
assert.equal(sandKindOf({ icon: 'hkcwx' }), 'vault')
assert.equal(sandKindOf({ icon: 'yf' }), 'bags')
assert.equal(sandKindOf({ icon: 'fydjz' }), 'special')
assert.equal(sandKindOf({ icon: 'tilapia', catalog: 'fish' }), null)
assert.equal(sandIconOf({ icon: 'placeholder', name: '骇客电脑' }), 'dn')
assert.equal(sandKindOf({ icon: 'placeholder', name: '个人储物柜' }), 'bags')
assert.equal(sandKindOf({ icon: 'placeholder', name: '神秘物品' }), null)

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
  '00': { info: dabaInfo, icons: mapArticle, poi: selectRegion, name: '零号大坝', level: '常规', layer: 'map_db' },
  '00_B1': { info: dabaInfo, icons: dabaInfo.floorInfo.mapArticle_minus, name: '零号大坝', level: '常规', layer: 'daba_0f' },
  '10': { info: cgxgInfo, icons: mapArticle_cgxg, poi: selectRegion_cgxg, name: '长弓溪谷', level: '常规', layer: 'map_yc' },
  '10_ldz_2F': { info: cgxgInfo, icons: cgxgInfo.floorInfo.mapArticle_ldz_2f, name: '长弓溪谷', level: '常规', layer: 'cgxg_ldz_2f' },
  '10_s': { info: cgxgInfo, icons: mapArticle2_cgxg, poi: selectRegion_cgxg, name: '长弓溪谷', level: '常规｜坠机事件', layer: 'map_yc2' },
  '10_s_1F': { info: cgxgInfo, icons: cgxgInfo.floorInfo.mapArticle_s_first, name: '长弓溪谷', level: '常规', layer: 'cgxg_1f' },
  '50': { info: az3Info, icons: mapArticle_az3, poi: selectRegion_az3, name: 'AZ3', level: '常规', layer: 'map_az3' },
  '50_1_3F': { info: az3Info, icons: az3Info.floorInfo.mapArticle_first3, name: 'RBMK反应堆', level: '常规',
    // layer: 'map_az3',
    layer: 'az3_3_1f' },
`)
assert.deepEqual(
  table.get('长弓溪谷').map(entry => entry.level),
  ['常规', '常规｜坠机事件'],
)
assert.deepEqual(table.get('零号大坝')[0].floors, [
  { icons: 'dabaInfo.floorInfo.mapArticle_minus', layer: 'daba_0f', code: 'B1' },
])
assert.deepEqual(
  table.get('长弓溪谷').map(entry => entry.floors.map(floor => floor.code)),
  [['2F'], ['1F']],
)
assert.deepEqual(table.get('AZ3')[0].floors[0], {
  icons: 'az3Info.floorInfo.mapArticle_first3',
  layer: 'az3_3_1f',
  code: '1F',
})
assert.deepEqual(
  inlineIcon(
    '.img_nav_xdjqz_click { a } .img_nav_xdjqz {\n background: url("data:image/png;base64,aGk=") }',
    'xdjqz',
  ),
  Buffer.from('hi'),
)
assert.equal(inlineIcon('.img_nav_boss { color: red }', 'boss'), null)
assert.equal(buildingOf('cgxg_ldz_b1'), 'cgxg_ldz')
assert.equal(buildingOf('az3_1_2f'), 'az3_1')

assert.deepEqual(
  exitsOf([
    {
      name: '常规',
      points: [
        ['exit', 0, 0, '付费撤离点', '近A'],
        ['boss', 0, 0, 'X', ''],
        ['exit', 0, 0, '电梯撤离点', '2F', 3, '0:2F'],
      ],
    },
    {
      name: '机密',
      points: [
        ['exit', 0, 0, '付费撤离点', '近A'],
        ['exit', 0, 0, '拉闸撤离点', '近B'],
      ],
    },
  ]),
  [
    ['付费撤离点', '近A', ''],
    ['拉闸撤离点', '近B', '机密'],
  ],
)

console.log('delta maps: ok')
