export const LOADOUT_MODES = { operations: '烽火地带', warfare: '全面战场' } as const
export type LoadoutMode = keyof typeof LOADOUT_MODES

export const WEAPON_CATEGORIES = [
  '步枪',
  '冲锋枪',
  '精确射手步枪',
  '狙击步枪',
  '轻机枪',
  '霰弹枪',
  '手枪',
  '特殊武器',
] as const
export type WeaponCategory = (typeof WEAPON_CATEGORIES)[number]

export interface DeltaWeapon {
  readonly name: string
  readonly short: string
  readonly category: WeaponCategory
  readonly caliber: string
  readonly image: string | null
}

type Row = readonly [name: string, short: string, caliber: string, image?: string]

const ROSTER: Record<WeaponCategory, readonly Row[]> = {
  步枪: [
    ['M4A1突击步枪', 'M4A1', '5.56x45mm', '18010000001'],
    ['AKM突击步枪', 'AKM', '7.62x39mm', '18010000006'],
    ['QBZ95-1突击步枪', 'QBZ95-1', '5.8x42mm', '18010000008'],
    ['AKS-74U突击步枪', 'AKS-74U', '5.45x39mm', '18010000010'],
    ['MK47突击步枪', 'MK47', '7.62x39mm', '18010000011'],
    ['ASh-12战斗步枪', 'ASh-12', '12.7x55mm', '18010000012'],
    ['K416突击步枪', 'K416', '5.56x45mm', '18010000013'],
    ['M16A4突击步枪', 'M16A4', '5.56x45mm', '18010000014'],
    ['AUG突击步枪', 'AUG', '5.56x45mm', '18010000015'],
    ['M7战斗步枪', 'M7', '6.8x51mm', '18010000016'],
    ['SG552突击步枪', 'SG552', '5.56x45mm', '18010000017'],
    ['AK-12突击步枪', 'AK-12', '5.45x39mm', '18010000018'],
    ['SCAR-H战斗步枪', 'SCAR-H', '7.62x51mm', '18010000021'],
    ['G3战斗步枪', 'G3', '7.62x51mm', '18010000023'],
    ['PTR-32突击步枪', 'PTR-32', '7.62x39mm', '18010000024'],
    ['CAR-15突击步枪', 'CAR-15', '5.56x45mm', '18010000031'],
    ['AS Val突击步枪', 'AS Val', '9x39mm', '18010000037'],
    ['腾龙突击步枪', '腾龙', '5.8x42mm', '18010000038'],
    ['K437突击步枪', 'K437', '.300 BLK', '18010000040'],
    ['KC17突击步枪', 'KC17', '5.45x39mm', '18010000042'],
    ['MCX LT突击步枪', 'MCX LT', '.300 BLK', '18010000044'],
    ['AR57突击步枪', 'AR57', '5.7x28mm', '18010000045'],
    ['MDR突击步枪', 'MDR', '7.62x51mm', '18010000049'],
    ['RM277突击步枪', 'RM277', '6.8x51mm', '18010000051'],
  ],
  冲锋枪: [
    ['MP5冲锋枪', 'MP5', '9x19mm', '18020000001'],
    ['P90冲锋枪', 'P90', '5.7x28mm', '18020000002'],
    ['Vector冲锋枪', 'Vector', '.45 ACP', '18020000003'],
    ['UZI冲锋枪', 'UZI', '9x19mm', '18020000004'],
    ['野牛冲锋枪', '野牛', '9x19mm', '18020000005'],
    ['SMG-45冲锋枪', 'SMG-45', '.45 ACP', '18020000006'],
    ['SR-3M紧凑突击步枪', 'SR-3M', '9x39mm', '18020000008'],
    ['勇士冲锋枪', '勇士', '9x19mm', '18020000009'],
    ['MP7冲锋枪', 'MP7', '4.6x30mm', '18020000010'],
    ['QCQ171冲锋枪', 'QCQ171', '9x19mm', '18020000011'],
    ['MK4冲锋枪', 'MK4', '4.6x30mm', '18020000012'],
    ['汤姆逊冲锋枪', '汤姆逊', '.45 ACP', '18020000046'],
  ],
  精确射手步枪: [
    ['Mini-14射手步枪', 'Mini-14', '5.56x45mm', '18050000002'],
    ['VSS射手步枪', 'VSS', '9x39mm', '18050000003'],
    ['SVD狙击步枪', 'SVD', '7.62x54R', '18050000004'],
    ['M14射手步枪', 'M14', '7.62x51mm', '18050000005'],
    ['SKS射手步枪', 'SKS', '7.62x39mm', '18050000006'],
    ['SR-25射手步枪', 'SR-25', '7.62x51mm', '18050000007'],
    ['SR9射手步枪', 'SR9', '7.62x51mm', '18050000008'],
    ['PSG-1射手步枪', 'PSG-1', '7.62x51mm', '18050000031'],
    ['Marlin杠杆步枪', 'Marlin', '.45-70 Govt', '18050000032'],
    ['SVCH精确射手步枪', 'SVCH', '7.62x54R', '18050000033'],
  ],
  狙击步枪: [
    ['SV-98狙击步枪', 'SV-98', '7.62x54R', '18060000007'],
    ['R93狙击步枪', 'R93', '7.62x51mm', '18060000008'],
    ['M700狙击步枪', 'M700', '7.62x51mm', '18060000009'],
    ['AWM狙击步枪', 'AWM', '.338 Lapua Magnum', '18060000011'],
    ['M82狙击步枪', 'M82', '.50 BMG', '18060000033'],
  ],
  轻机枪: [
    ['PKM通用机枪', 'PKM', '7.62x54R', '18040000001'],
    ['M249轻机枪', 'M249', '5.56x45mm', '18040000002'],
    ['M250通用机枪', 'M250', '6.8x51mm', '18040000003'],
    ['QJB201轻机枪', 'QJB201', '5.8x42mm', '18040000004'],
  ],
  霰弹枪: [
    ['M1014霰弹枪', 'M1014', '12 Gauge', '18030000001'],
    ['S12K霰弹枪', 'S12K', '12 Gauge', '18030000002'],
    ['M870霰弹枪', 'M870', '12 Gauge', '18030000004'],
    ['725双管霰弹枪', '725', '12 Gauge', '18030000005'],
    ['FS-12霰弹枪', 'FS-12', '12 Gauge', '18030000006'],
  ],
  手枪: [
    ['QSZ92G', 'QSZ92G', '9x19mm', '18070000002'],
    ['.357左轮', '.357左轮', '.357 Magnum', '18070000003'],
    ['沙漠之鹰', '沙漠之鹰', '.50 AE', '18070000004'],
    ['G18', 'G18', '9x19mm', '18070000005'],
    ['93R', '93R', '9x19mm', '18070000006'],
    ['G17', 'G17', '9x19mm', '18070000010'],
    ['M1911', 'M1911', '.45 ACP', '18070000033'],
  ],
  特殊武器: [['复合弓', '复合弓', '箭矢']],
}

export const DELTA_WEAPONS: readonly DeltaWeapon[] = WEAPON_CATEGORIES.flatMap(category =>
  ROSTER[category].map(([name, short, caliber, image]) => ({
    name,
    short,
    category,
    caliber,
    image: image ? `/games/delta/weapons/${image}.webp` : null,
  })),
)

const BY_NAME = new Map(DELTA_WEAPONS.map(weapon => [weapon.name, weapon]))

export function findWeapon(name: string) {
  return BY_NAME.get(name)
}

export const LOADOUT_TAGS = [
  '后坐力稳',
  '腰射专用',
  '超高射速',
  '机动性强',
  '中近距离',
  '远程作战',
  '架枪稳定',
  '消音',
  '高性价比',
  '满改神器',
  '新手推荐',
  '赛事同款',
] as const
export const LOADOUT_TAG_LIMIT = 3

export const LOADOUT_STATS = [
  ['recoil', '后坐力控制'],
  ['handling', '操控速度'],
  ['stability', '据枪稳定性'],
  ['hipfire', '腰际射击精度'],
  ['distance', '优势射程'],
] as const
export type LoadoutStat = (typeof LOADOUT_STATS)[number][0]

export const PRICE_TIERS = {
  low: ['25w 以内', 0, 250_000],
  mid: ['25–50w', 250_001, 500_000],
  high: ['50w 以上', 500_001, Number.MAX_SAFE_INTEGER],
} as const
export type PriceTier = keyof typeof PRICE_TIERS

export function formatPrice(price: number) {
  return `${Number((price / 10_000).toFixed(1))}w`
}

export function shareString(weapon: string, mode: LoadoutMode, code: string) {
  return `${weapon}-${LOADOUT_MODES[mode]}-${code}`
}

const FIRST_SHARE = Date.UTC(2024, 8, 1)

export function codeSharedAt(code: string, now = Date.now()) {
  const millis = Math.floor(parseInt(code.slice(0, 7), 32) / 4) * 1000
  return millis >= FIRST_SHARE && millis <= now + 7 * 86_400_000 ? millis : null
}

export interface PastedLoadout {
  readonly code: string
  readonly mode: LoadoutMode | null
  readonly weapon: DeltaWeapon | null
  readonly label: string | null
}

const WITH_MODE = /(烽火地带|全面战场)\s*-\s*(?<code>[0-9A-Va-v]{21})(?![0-9A-Za-z])/
const BARE = /(?<![0-9A-Za-z])[0-9A-Va-v]{21}(?![0-9A-Za-z])/
const BY_SHORT = [...DELTA_WEAPONS].sort((a, b) => b.short.length - a.short.length)

export function parsePastedLoadout(text: string): PastedLoadout | null {
  const source = text.normalize('NFKC').replace(/[‐-―−]/g, '-')
  const full = WITH_MODE.exec(source)
  if (!full) {
    const bare = BARE.exec(source)
    return bare ? { code: bare[0].toUpperCase(), mode: null, weapon: null, label: null } : null
  }
  const mode = full[1] === LOADOUT_MODES.operations ? 'operations' : 'warfare'
  const head = source.slice(0, full.index).replace(/\s*-\s*$/, '')
  const label = (head.split(/[\n:：,，、(（【[「"“]/).at(-1) ?? '').trim()
  const weapon =
    DELTA_WEAPONS.find(entry => head.endsWith(entry.name)) ??
    BY_SHORT.find(entry => label.toUpperCase().includes(entry.short.toUpperCase())) ??
    null
  return {
    code: full.groups!.code!.toUpperCase(),
    mode,
    weapon,
    label: label && label !== weapon?.name ? label : null,
  }
}

export function matchLoadoutQuery(query: string) {
  const words = query.toUpperCase().split(/\s+/).filter(Boolean)
  const mode: LoadoutMode | null = words.some(word => /全面|大战场/.test(word))
    ? 'warfare'
    : words.some(word => /烽火|跑刀|摸金/.test(word))
      ? 'operations'
      : null
  const needles = words.filter(word => !/全面|大战场|烽火|跑刀|摸金/.test(word))
  const weapons = needles.length
    ? DELTA_WEAPONS.filter(weapon =>
        needles.some(
          needle =>
            weapon.name.toUpperCase().includes(needle) ||
            weapon.short.toUpperCase().replaceAll('-', '').includes(needle.replaceAll('-', '')) ||
            weapon.category === needle,
        ),
      )
    : null
  const label = weapons?.length === 1 ? weapons[0]!.short : needles.join(' ')
  return { mode, weapons, label, unmatched: Boolean(needles.length && !weapons?.length) }
}
