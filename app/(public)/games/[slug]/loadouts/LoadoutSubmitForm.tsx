'use client'

import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { useRef, useState, useTransition } from 'react'
import { Button, Field, TextField } from '@/components/ui'
import fieldStyles from '@/components/ui/Field.module.css'
import { renderWebp } from '@/lib/client-image'
import {
  DELTA_WEAPONS,
  LOADOUT_MODES,
  LOADOUT_STATS,
  LOADOUT_TAG_LIMIT,
  LOADOUT_TAGS,
  WEAPON_CATEGORIES,
  codeSharedAt,
  findWeapon,
  parsePastedLoadout,
  type LoadoutMode,
} from '@/lib/delta-loadouts'
import { siteDayKey } from '@/lib/datetime'
import { submitLoadoutCodeAction, type LoadoutSubmission } from './actions'
import { LoadoutPreview } from './LoadoutPreview'
import { LoadoutShotField } from './LoadoutShotField'
import { useLoadoutLookup } from './LoadoutLookup'
import styles from './LoadoutSubmitForm.module.css'

export function LoadoutSubmitForm({ slug, initialCode }: { slug: string; initialCode?: string }) {
  const initial = initialCode ? parsePastedLoadout(initialCode) : null
  const router = useRouter()
  const form = useRef<HTMLFormElement>(null)
  const [pending, startTransition] = useTransition()
  const [result, setResult] = useState<LoadoutSubmission | null>(null)
  const [code, setCode] = useState(initial ? initialCode! : '')
  const [mode, setMode] = useState<LoadoutMode>(initial?.mode ?? 'operations')
  const [weapon, setWeapon] = useState(initial?.weapon?.name ?? '')
  const [title, setTitle] = useState(initial?.label?.slice(0, 40) ?? '')
  const [tags, setTags] = useState<string[]>([])
  const [shot, setShot] = useState<string | null>(null)
  const [draft, setDraft] = useState<Record<string, string>>({})
  const { parsed, found } = useLoadoutLookup(slug, code)
  const picked = findWeapon(weapon)
  const sharedAt = parsed ? codeSharedAt(parsed.code) : null
  const fieldError = (field: string) =>
    result && !result.ok && result.field === field ? result.error : undefined

  function paste(value: string) {
    setCode(value)
    const next = parsePastedLoadout(value)
    if (next?.mode) setMode(next.mode)
    if (next?.weapon) setWeapon(next.weapon.name)
    if (next?.label && !title) setTitle(next.label.slice(0, 40))
  }

  function snapshot() {
    if (!form.current) return
    const data = new FormData(form.current)
    setDraft(
      Object.fromEntries([...data].filter(([, value]) => typeof value === 'string')) as never,
    )
  }

  function reset() {
    form.current?.reset()
    setCode('')
    setWeapon('')
    setTitle('')
    setTags([])
    setShot(null)
    setDraft({})
  }

  return (
    <div className={styles.composer}>
      <form
        ref={form}
        onInput={snapshot}
        className={styles.form}
        aria-busy={pending}
        action={data =>
          startTransition(async () => {
            const file = data.get('shot')
            if (file instanceof File && file.size > 0) {
              const webp = await renderWebp(file, 1920, 0.85).catch(() => null)
              if (!webp) {
                setResult({ ok: false, error: '这张图片无法读取，换一张试试。', field: 'shot' })
                return
              }
              data.set('shot', webp)
            }
            const outcome = await submitLoadoutCodeAction(slug, data).catch(() => ({
              ok: false as const,
              error: '网络异常，请稍后重试。',
            }))
            setResult(outcome)
            if (outcome.ok) {
              reset()
              router.refresh()
            }
          })
        }
      >
        <TextField
          id="loadout-code"
          name="code"
          label="改枪码"
          rows={2}
          maxLength={300}
          required
          value={code}
          onChange={event => paste(event.target.value)}
          placeholder="例如：M4A1突击步枪-烽火地带-6I57UD4080ELE0AQVMCG8"
          spellCheck={false}
          autoComplete="off"
          error={fieldError('code')}
        />
        <p className={styles.detected} aria-live="polite">
          {found ? (
            <>
              这套码已收录
              {found.source === 'official' ? '在官方精选' : `，由 ${found.authorName} 分享`}
              ，不用重复投稿：
              <Link href={`/games/${slug}/loadouts/${found.id}`}>「{found.title}」→</Link>
            </>
          ) : !code.trim() ? (
            '粘贴后会自动认出武器、模式和分享日期。'
          ) : !parsed ? (
            '还没认出改枪码：需要完整串，或末尾 21 位码。'
          ) : (
            `已识别 ${parsed.code}${parsed.weapon ? ` · ${parsed.weapon.short}` : ''}${
              parsed.mode ? ` · ${LOADOUT_MODES[parsed.mode]}` : ''
            }${sharedAt ? ` · 分享于 ${siteDayKey(sharedAt)}` : ''}`
          )}
        </p>

        <LoadoutShotField error={fieldError('shot')} onPick={setShot} />

        <div className={styles.pair}>
          <fieldset className={styles.segmented}>
            <legend className={fieldStyles.label}>
              模式<span className={fieldStyles.required}>*</span>
            </legend>
            {(Object.keys(LOADOUT_MODES) as LoadoutMode[]).map(entry => (
              <label key={entry}>
                <input
                  type="radio"
                  name="mode"
                  value={entry}
                  checked={mode === entry}
                  onChange={() => setMode(entry)}
                />
                <span>{LOADOUT_MODES[entry]}</span>
              </label>
            ))}
          </fieldset>
          <div className={fieldStyles.field}>
            <label className={fieldStyles.label} htmlFor="loadout-weapon">
              武器<span className={fieldStyles.required}>*</span>
              {picked ? (
                <span className={fieldStyles.hint}>
                  {picked.category} · {picked.caliber}
                </span>
              ) : null}
            </label>
            <select
              id="loadout-weapon"
              name="weapon"
              className={fieldStyles.control}
              required
              value={weapon}
              onChange={event => setWeapon(event.target.value)}
              aria-invalid={fieldError('weapon') ? true : undefined}
            >
              <option value="" disabled>
                选择武器
              </option>
              {WEAPON_CATEGORIES.map(category => (
                <optgroup key={category} label={category}>
                  {DELTA_WEAPONS.filter(entry => entry.category === category).map(entry => (
                    <option key={entry.name} value={entry.name}>
                      {entry.name}
                    </option>
                  ))}
                </optgroup>
              ))}
            </select>
          </div>
        </div>

        <div className={styles.pair}>
          <Field
            id="loadout-title"
            name="title"
            label="方案名"
            maxLength={40}
            hint="例如：30w 稳压 M4"
            required
            value={title}
            onChange={event => setTitle(event.target.value)}
            error={fieldError('title')}
          />
          {mode === 'operations' ? (
            <Field
              id="loadout-price"
              name="price"
              label="价格（万哈夫币）"
              inputMode="decimal"
              pattern="\d{1,4}(\.\d)?"
              hint="选填，改枪台显示的总价"
              error={fieldError('price')}
            />
          ) : null}
        </div>

        <fieldset className={styles.tagPicker}>
          <legend className={fieldStyles.label}>
            标签<span className={fieldStyles.hint}>最多 {LOADOUT_TAG_LIMIT} 个</span>
          </legend>
          {LOADOUT_TAGS.map(tag => (
            <label key={tag}>
              <input
                type="checkbox"
                name="tags"
                value={tag}
                checked={tags.includes(tag)}
                disabled={!tags.includes(tag) && tags.length >= LOADOUT_TAG_LIMIT}
                onChange={event =>
                  setTags(event.target.checked ? [...tags, tag] : tags.filter(item => item !== tag))
                }
              />
              <span>{tag}</span>
            </label>
          ))}
        </fieldset>

        <fieldset className={styles.statInputs}>
          <legend className={fieldStyles.label}>
            改装后属性
            <span className={fieldStyles.hint}>选填，照改枪台右侧数值填写，要填就五项都填</span>
          </legend>
          {LOADOUT_STATS.map(([key, label]) => (
            <Field
              key={key}
              id={`loadout-${key}`}
              name={key}
              label={key === 'distance' ? `${label}（m）` : label}
              inputMode="numeric"
              pattern="\d{1,3}"
              maxLength={3}
            />
          ))}
          {fieldError('stats') ? (
            <p className={fieldStyles.error} role="alert">
              {fieldError('stats')}
            </p>
          ) : null}
        </fieldset>

        <Field
          id="loadout-note"
          name="note"
          label="说明"
          maxLength={200}
          hint="选填，适用地图、打法或配件取舍"
          error={fieldError('note')}
        />
        <div className={styles.actions}>
          <Button type="submit" variant="primary" disabled={pending}>
            {pending ? '正在提交…' : '提交审核'}
          </Button>
          {result?.ok ? (
            <p className={styles.success} role="status">
              已提交，审核通过后会展示在列表里。
            </p>
          ) : result &&
            !result.ok &&
            !['code', 'title', 'note', 'price', 'stats', 'shot'].includes(result.field ?? '') ? (
            <p className={styles.error} role="alert">
              {result.error}
              {result.signIn ? <Link href="/login">去登录 →</Link> : null}
            </p>
          ) : null}
        </div>
      </form>
      <aside className={styles.preview} aria-label="卡片预览">
        <p className={styles.previewLabel}>PREVIEW · 审核通过后长这样</p>
        <LoadoutPreview
          slug={slug}
          mode={mode}
          weapon={weapon}
          code={parsed?.code ?? ''}
          title={title}
          tags={tags}
          draft={draft}
          shot={shot}
        />
      </aside>
    </div>
  )
}
