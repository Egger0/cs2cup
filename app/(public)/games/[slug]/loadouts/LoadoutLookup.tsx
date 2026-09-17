'use client'

import Link from 'next/link'
import { useEffect, useState } from 'react'
import { LOADOUT_MODES, codeSharedAt, parsePastedLoadout } from '@/lib/delta-loadouts'
import { siteDayKey } from '@/lib/datetime'
import { lookupLoadoutCodeAction } from './actions'
import styles from './LoadoutLookup.module.css'

type Found = Awaited<ReturnType<typeof lookupLoadoutCodeAction>>

export function useLoadoutLookup(slug: string, value: string) {
  const [found, setFound] = useState<{ code: string; result: Found } | null>(null)
  const parsed = value.trim() ? parsePastedLoadout(value) : null
  const code = parsed?.code ?? null
  useEffect(() => {
    if (!code) return
    let cancelled = false
    const timer = setTimeout(() => {
      lookupLoadoutCodeAction(slug, code)
        .then(result => {
          if (!cancelled) setFound({ code, result })
        })
        .catch(() => {})
    }, 250)
    return () => {
      cancelled = true
      clearTimeout(timer)
    }
  }, [slug, code])
  return { parsed, found: code && found?.code === code ? found.result : null }
}

export function LoadoutLookup({ slug }: { slug: string }) {
  const [value, setValue] = useState('')
  const { parsed, found } = useLoadoutLookup(slug, value)
  const sharedAt = parsed ? codeSharedAt(parsed.code) : null

  return (
    <div className={styles.lookup}>
      <label htmlFor="loadout-lookup" className={styles.label}>
        查码
        <span>贴一串改枪码，看看它是什么方案</span>
      </label>
      <input
        id="loadout-lookup"
        className={styles.input}
        value={value}
        onChange={event => setValue(event.target.value)}
        placeholder="例如：M700狙击步枪-烽火地带-6L8CPOS04C9NGO2DGDCB8"
        spellCheck={false}
        autoComplete="off"
      />
      <p className={styles.result} aria-live="polite">
        {!value.trim() ? null : !parsed ? (
          '还没认出改枪码：需要完整串，或末尾 21 位码。'
        ) : found ? (
          <>
            已收录{found.source === 'official' ? '在官方精选' : `，由 ${found.authorName} 分享`}：
            <Link href={`/games/${slug}/loadouts/${found.id}`}>「{found.title}」→</Link>
          </>
        ) : (
          <>
            {parsed.weapon?.short ?? '未知武器'}
            {parsed.mode ? ` · ${LOADOUT_MODES[parsed.mode]}` : ''}
            {sharedAt ? ` · 分享于 ${siteDayKey(sharedAt)}` : ''} · 站里还没有这套，
            <Link
              href={`/games/${slug}/loadouts?paste=${encodeURIComponent(value.trim())}#loadout-submit`}
            >
              投稿收录 →
            </Link>
          </>
        )}
      </p>
    </div>
  )
}
