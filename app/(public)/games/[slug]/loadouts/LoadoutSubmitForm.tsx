'use client'

import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { useRef, useState, useTransition } from 'react'
import { Button, Field, TextField } from '@/components/ui'
import { submitLoadoutCodeAction, type LoadoutSubmission } from './actions'
import styles from './loadouts.module.css'

export function LoadoutSubmitForm({ slug }: { slug: string }) {
  const router = useRouter()
  const form = useRef<HTMLFormElement>(null)
  const [pending, startTransition] = useTransition()
  const [result, setResult] = useState<LoadoutSubmission | null>(null)
  const fieldError = (field: string) =>
    result && !result.ok && result.field === field ? result.error : undefined

  return (
    <form
      ref={form}
      className={styles.form}
      aria-busy={pending}
      action={data =>
        startTransition(async () => {
          const outcome = await submitLoadoutCodeAction(slug, data).catch(() => ({
            ok: false as const,
            error: '网络异常，请稍后重试。',
          }))
          setResult(outcome)
          if (outcome.ok) {
            form.current?.reset()
            router.refresh()
          }
        })
      }
    >
      <div className={styles.pair}>
        <Field
          id="loadout-weapon"
          name="weapon"
          label="武器"
          maxLength={30}
          required
          error={fieldError('weapon')}
        />
        <Field
          id="loadout-title"
          name="title"
          label="标题"
          maxLength={40}
          hint="例如：低后坐腰射流"
          required
          error={fieldError('title')}
        />
      </div>
      <TextField
        id="loadout-code"
        name="code"
        label="改枪码"
        rows={3}
        maxLength={200}
        required
        error={fieldError('code')}
      />
      <Field
        id="loadout-note"
        name="note"
        label="说明"
        maxLength={200}
        hint="选填，适用地图或打法"
        error={fieldError('note')}
      />
      <div className={styles.actions}>
        <Button type="submit" variant="primary" disabled={pending}>
          {pending ? '正在提交…' : '提交审核'}
        </Button>
        {result?.ok ? (
          <p className={styles.success} role="status">
            已提交，审核通过后会展示在这里。
          </p>
        ) : result && !result.field ? (
          <p className={styles.error} role="alert">
            {result.error}
            {result.signIn ? <Link href="/login">去登录 →</Link> : null}
          </p>
        ) : null}
      </div>
    </form>
  )
}
