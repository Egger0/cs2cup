export type ParseResult<T> = { ok: true; value: T } | { ok: false; error: string }

export const TOURNAMENT_FORM_LIMITS = {
  title: 120,
  heroBottom: 120,
  heroEyebrow: 80,
  lede: 500,
  championName: 120,
  championNote: 200,
  teamCap: 128,
  mapPoolText: 2_000,
  mapPoolItems: 30,
  mapName: 60,
  collectionText: 50_000,
  collectionItems: 30,
} as const

const CONTROL_CHARACTER = /[\u0000-\u0009\u000b\u000c\u000e-\u001f\u007f-\u009f]/u
const LINE_BREAK = /[\r\n\u2028\u2029]/u

export function validatedText(
  value: unknown,
  label: string,
  maxLength: number,
  options: { required?: boolean; multiline?: boolean } = {},
): ParseResult<string> {
  if (typeof value !== 'string') return { ok: false, error: `${label}格式无效` }

  const text = value.trim()
  if (!text && options.required) return { ok: false, error: `${label}不能为空` }
  if (text.length > maxLength) {
    return { ok: false, error: `${label}不能超过 ${maxLength} 个字符` }
  }
  if (CONTROL_CHARACTER.test(text) || (!options.multiline && LINE_BREAK.test(text))) {
    return { ok: false, error: `${label}包含无效字符` }
  }
  return { ok: true, value: text }
}

export function formText(
  form: FormData,
  name: string,
  label: string,
  maxLength: number,
  options?: { required?: boolean; multiline?: boolean },
) {
  return validatedText(form.get(name) ?? '', label, maxLength, options)
}

export function normalizedKey(value: string) {
  return value.normalize('NFKC').toLocaleLowerCase('zh-CN')
}
