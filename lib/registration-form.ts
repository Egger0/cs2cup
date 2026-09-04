import { validateRegistrationRoster, type RegistrationRosterPlayer } from './registration'

export interface RegistrationFormValues {
  name: string
  tag: string
  captain: string
  contact: string
  dept: string
  note: string
  players: RegistrationRosterPlayer[]
}

export interface RegistrationDraftValues {
  name: string
  tag: string
  captain: string
  contact: string
  dept: string
  note: string
  players: [string, string, string, string, string, string]
}

type RegistrationFormResult =
  | { ok: true; values: RegistrationFormValues }
  | { ok: false; error: string }

const FIELD_LIMITS = {
  name: 20,
  tag: 5,
  captain: 20,
  contact: 40,
  dept: 30,
  note: 120,
  player: 20,
} as const

const CONTROL_CHARACTER = /[\u0000-\u0009\u000b\u000c\u000e-\u001f\u007f-\u009f]/u
const LINE_BREAK = /[\r\n\u2028\u2029]/u

function formText(form: FormData, name: string, maxLength: number, multiline = false) {
  const entry = form.get(name)
  if (entry !== null && typeof entry !== 'string') {
    throw new TypeError(`${name} must be text`)
  }
  const value = (entry ?? '').trim()
  if (
    value.length > maxLength ||
    CONTROL_CHARACTER.test(value) ||
    (!multiline && LINE_BREAK.test(value))
  ) {
    throw new RangeError(`${name} contains invalid text`)
  }
  return value
}

export function parseRegistrationForm(form: FormData): RegistrationFormResult {
  let values: Omit<RegistrationFormValues, 'players'> & {
    players: RegistrationRosterPlayer[]
  }
  try {
    values = {
      name: formText(form, 'name', FIELD_LIMITS.name),
      tag: formText(form, 'tag', FIELD_LIMITS.tag).toUpperCase(),
      captain: formText(form, 'captain', FIELD_LIMITS.captain),
      contact: formText(form, 'contact', FIELD_LIMITS.contact),
      dept: formText(form, 'dept', FIELD_LIMITS.dept),
      note: formText(form, 'note', FIELD_LIMITS.note, true),
      players: [1, 2, 3, 4, 5, 6].map(index => ({
        nickname: formText(form, `player${index}`, FIELD_LIMITS.player),
        substitute: index === 6,
      })),
    }
  } catch {
    return { ok: false, error: '报名信息格式或长度无效，请检查后重试' }
  }

  if (!values.name || !values.tag || !values.captain || !values.contact) {
    return { ok: false, error: '请填写完整的必填项' }
  }
  if (values.tag.length < 2 || values.tag.length > 5) {
    return { ok: false, error: '战队 TAG 需要 2 到 5 个字符' }
  }
  const roster = validateRegistrationRoster(values.players)
  if (!roster.ok) return { ok: false, error: roster.error }
  return { ok: true, values: { ...values, players: roster.players } }
}

export function parseRegistrationDraftForm(form: FormData) {
  try {
    return {
      ok: true as const,
      values: {
        name: formText(form, 'name', FIELD_LIMITS.name),
        tag: formText(form, 'tag', FIELD_LIMITS.tag).toUpperCase(),
        captain: formText(form, 'captain', FIELD_LIMITS.captain),
        contact: formText(form, 'contact', FIELD_LIMITS.contact),
        dept: formText(form, 'dept', FIELD_LIMITS.dept),
        note: formText(form, 'note', FIELD_LIMITS.note, true),
        players: [1, 2, 3, 4, 5, 6].map(index =>
          formText(form, `player${index}`, FIELD_LIMITS.player),
        ) as RegistrationDraftValues['players'],
      },
    }
  } catch {
    return { ok: false as const, error: '草稿内容格式或长度无效，请检查后重试' }
  }
}
