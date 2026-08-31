import { dateTimeLocalToIso } from './datetime'
import {
  formText,
  normalizedKey,
  type ParseResult,
  TOURNAMENT_FORM_LIMITS,
  validatedText,
} from './tournament-form-validation'
import type { FaqItem, RuleItem, TournamentStatus } from './types'

export interface TournamentUpdateValues {
  title: string
  hero_bottom: string
  hero_eyebrow: string
  lede: string
  status: TournamentStatus
  team_cap: number
  game_id: number
  reg_deadline: string | null
  starts_at: string | null
  map_pool: string[]
  rules: RuleItem[]
  faqs: FaqItem[]
  champion_name: string | null
  champion_note: string | null
}

const TOURNAMENT_STATES = new Set<TournamentStatus>([
  'draft',
  'registration',
  'running',
  'finished',
  'postponed',
])

function integerField(
  form: FormData,
  name: string,
  label: string,
  minimum: number,
  maximum: number,
): ParseResult<number> {
  const raw = formText(form, name, label, 16, { required: true })
  if (!raw.ok) return raw
  if (!/^[1-9]\d*$/.test(raw.value)) {
    return { ok: false, error: `${label}必须是整数` }
  }

  const value = Number(raw.value)
  if (!Number.isSafeInteger(value) || value < minimum || value > maximum) {
    return { ok: false, error: `${label}必须在 ${minimum} 到 ${maximum} 之间` }
  }
  return { ok: true, value }
}

function parseArray(raw: string, label: string): ParseResult<unknown[]> {
  const source = raw.trim()
  if (!source) return { ok: true, value: [] }

  let value: unknown
  try {
    value = JSON.parse(source)
  } catch {
    return { ok: false, error: `${label}必须是有效的 JSON 数组` }
  }
  if (!Array.isArray(value) || value.length > TOURNAMENT_FORM_LIMITS.collectionItems) {
    return {
      ok: false,
      error: `${label}必须是不超过 ${TOURNAMENT_FORM_LIMITS.collectionItems} 项的 JSON 数组`,
    }
  }
  return { ok: true, value }
}

function record(value: unknown) {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null
}

function parseRules(raw: string): ParseResult<RuleItem[]> {
  const parsed = parseArray(raw, '赛事规则')
  if (!parsed.ok) return parsed

  const rules: RuleItem[] = []
  const titles = new Set<string>()
  for (const [index, value] of parsed.value.entries()) {
    const item = record(value)
    if (!item) return { ok: false, error: `第 ${index + 1} 条规则格式无效` }
    const label = validatedText(item.label, `第 ${index + 1} 条规则标签`, 40, { required: true })
    if (!label.ok) return label
    const title = validatedText(item.title, `第 ${index + 1} 条规则标题`, 100, {
      required: true,
    })
    if (!title.ok) return title
    const body = validatedText(item.body, `第 ${index + 1} 条规则内容`, 1_000, {
      required: true,
      multiline: true,
    })
    if (!body.ok) return body

    const key = normalizedKey(title.value)
    if (titles.has(key)) return { ok: false, error: `规则标题「${title.value}」重复` }
    titles.add(key)
    rules.push({ label: label.value, title: title.value, body: body.value })
  }
  return { ok: true, value: rules }
}

function parseFaqs(raw: string): ParseResult<FaqItem[]> {
  const parsed = parseArray(raw, '常见问题')
  if (!parsed.ok) return parsed

  const faqs: FaqItem[] = []
  const questions = new Set<string>()
  for (const [index, value] of parsed.value.entries()) {
    const item = record(value)
    if (!item) return { ok: false, error: `第 ${index + 1} 条常见问题格式无效` }
    const question = validatedText(item.question, `第 ${index + 1} 个问题`, 200, {
      required: true,
    })
    if (!question.ok) return question
    const answer = validatedText(item.answer, `第 ${index + 1} 个答案`, 2_000, {
      required: true,
      multiline: true,
    })
    if (!answer.ok) return answer

    const key = normalizedKey(question.value)
    if (questions.has(key)) return { ok: false, error: `问题「${question.value}」重复` }
    questions.add(key)
    faqs.push({ question: question.value, answer: answer.value })
  }
  return { ok: true, value: faqs }
}

function optionalDate(form: FormData, name: string, label: string): ParseResult<string | null> {
  const raw = formText(form, name, label, 16)
  if (!raw.ok) return raw
  if (!raw.value) return { ok: true, value: null }
  const value = dateTimeLocalToIso(raw.value)
  return value ? { ok: true, value } : { ok: false, error: `${label}格式无效` }
}

function parseMapPool(form: FormData): ParseResult<string[]> {
  const raw = formText(form, 'mapPool', '地图池', TOURNAMENT_FORM_LIMITS.mapPoolText)
  if (!raw.ok) return raw

  const entries = raw.value
    .split(/[,，]/)
    .map(entry => entry.trim())
    .filter(Boolean)
  if (entries.length > TOURNAMENT_FORM_LIMITS.mapPoolItems) {
    return { ok: false, error: `地图池不能超过 ${TOURNAMENT_FORM_LIMITS.mapPoolItems} 项` }
  }

  const names = new Set<string>()
  for (const entry of entries) {
    if (entry.length > TOURNAMENT_FORM_LIMITS.mapName) {
      return { ok: false, error: `地图名称不能超过 ${TOURNAMENT_FORM_LIMITS.mapName} 个字符` }
    }
    const key = normalizedKey(entry)
    if (names.has(key)) return { ok: false, error: `地图「${entry}」重复` }
    names.add(key)
  }
  return { ok: true, value: entries }
}

export function parseTournamentUpdate(form: FormData): ParseResult<TournamentUpdateValues> {
  const status = formText(form, 'status', '赛事状态', 20, { required: true })
  if (!status.ok) return status
  if (!TOURNAMENT_STATES.has(status.value as TournamentStatus)) {
    return { ok: false, error: '赛事状态无效' }
  }
  const teamCap = integerField(form, 'teamCap', '席位数', 2, TOURNAMENT_FORM_LIMITS.teamCap)
  if (!teamCap.ok) return teamCap
  const gameId = integerField(form, 'gameId', '比赛项目', 1, Number.MAX_SAFE_INTEGER)
  if (!gameId.ok) return gameId

  const regDeadline = optionalDate(form, 'regDeadline', '报名截止时间')
  if (!regDeadline.ok) return regDeadline
  const startsAt = optionalDate(form, 'startsAt', '开赛时间')
  if (!startsAt.ok) return startsAt
  if (
    regDeadline.value &&
    startsAt.value &&
    Date.parse(regDeadline.value) >= Date.parse(startsAt.value)
  ) {
    return { ok: false, error: '报名截止时间必须早于开赛时间' }
  }

  const mapPool = parseMapPool(form)
  if (!mapPool.ok) return mapPool
  const rulesText = formText(form, 'rules', '赛事规则', TOURNAMENT_FORM_LIMITS.collectionText, {
    multiline: true,
  })
  if (!rulesText.ok) return rulesText
  const rules = parseRules(rulesText.value)
  if (!rules.ok) return rules
  const faqsText = formText(form, 'faqs', '常见问题', TOURNAMENT_FORM_LIMITS.collectionText, {
    multiline: true,
  })
  if (!faqsText.ok) return faqsText
  const faqs = parseFaqs(faqsText.value)
  if (!faqs.ok) return faqs

  const title = formText(form, 'title', '赛事名称', TOURNAMENT_FORM_LIMITS.title, {
    required: true,
  })
  if (!title.ok) return title
  const heroBottom = formText(form, 'heroBottom', '标题主词', TOURNAMENT_FORM_LIMITS.heroBottom)
  if (!heroBottom.ok) return heroBottom
  const heroEyebrow = formText(form, 'heroEyebrow', '状态文案', TOURNAMENT_FORM_LIMITS.heroEyebrow)
  if (!heroEyebrow.ok) return heroEyebrow
  const lede = formText(form, 'lede', '赛事介绍', TOURNAMENT_FORM_LIMITS.lede, {
    multiline: true,
  })
  if (!lede.ok) return lede
  const championName = formText(
    form,
    'championName',
    '冠军战队',
    TOURNAMENT_FORM_LIMITS.championName,
  )
  if (!championName.ok) return championName
  const championNote = formText(
    form,
    'championNote',
    '荣誉备注',
    TOURNAMENT_FORM_LIMITS.championNote,
  )
  if (!championNote.ok) return championNote

  return {
    ok: true,
    value: {
      title: title.value,
      hero_bottom: heroBottom.value,
      hero_eyebrow: heroEyebrow.value,
      lede: lede.value,
      status: status.value as TournamentStatus,
      team_cap: teamCap.value,
      game_id: gameId.value,
      reg_deadline: regDeadline.value,
      starts_at: startsAt.value,
      map_pool: mapPool.value,
      rules: rules.value,
      faqs: faqs.value,
      champion_name: championName.value || null,
      champion_note: championNote.value || null,
    },
  }
}
