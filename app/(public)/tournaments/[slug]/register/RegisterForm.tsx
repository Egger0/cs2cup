'use client'

import Link from 'next/link'
import { useEffect, useRef, useState } from 'react'
import { Button, Field, TextField } from '@/components/ui'
import type { RegistrationDraftValues } from '@/lib/registration-form'
import { registerTeam, saveTeamDraft } from './actions'
import styles from './register.module.css'

export function RegisterForm({
  slug,
  canSubmit,
  initialValues,
}: {
  slug: string
  canSubmit: boolean
  initialValues?: RegistrationDraftValues | null
}) {
  const [error, setError] = useState('')
  const [recoveryPath, setRecoveryPath] = useState<string | null>(null)
  const [pending, setPending] = useState(false)
  const [draftSavedAt, setDraftSavedAt] = useState<number | null>(null)
  const [receipt, setReceipt] = useState<{
    managePath: string
    seatsLeft: number | null
  } | null>(null)
  const errorRef = useRef<HTMLParagraphElement>(null)
  const receiptTitleRef = useRef<HTMLHeadingElement>(null)

  useEffect(() => {
    if (error) errorRef.current?.focus()
  }, [error])

  useEffect(() => {
    if (receipt) receiptTitleRef.current?.focus()
  }, [receipt])

  async function submit(form: FormData) {
    setError('')
    setRecoveryPath(null)
    setDraftSavedAt(null)
    setPending(true)
    try {
      if (form.get('intent') === 'draft') {
        const result = await saveTeamDraft(slug, form)
        if (!result.ok) {
          setError(result.error ?? '草稿保存失败，请稍后重试')
          setRecoveryPath(result.redirectTo ?? null)
          return
        }
        setDraftSavedAt(result.updatedAt ?? Date.now())
        return
      }
      const result = await registerTeam(slug, form)
      if (!result.ok) {
        setError(result.error ?? '提交失败，请稍后重试')
        setRecoveryPath(result.redirectTo ?? null)
        return
      }
      if (!result.managePath) {
        setError('报名已提交，但账号入口暂时不可用；请前往“我的赛事”查看。')
        return
      }
      setReceipt({
        managePath: result.managePath,
        seatsLeft: result.seatsLeft ?? null,
      })
    } catch {
      setError('网络异常，请稍后重试')
    } finally {
      setPending(false)
    }
  }

  if (receipt) {
    return (
      <section className={styles.receipt} aria-labelledby="registration-receipt-title">
        <span className="readout">报名回执</span>
        <h2 ref={receiptTitleRef} id="registration-receipt-title" tabIndex={-1}>
          报名已提交
        </h2>
        <p>这份报名已经归入你的账号，可随时从“我的赛事”查看审核状态或修改阵容。</p>
        <div className={styles.passHandoff}>
          <span aria-hidden="true">ACCOUNT / READY</span>
          <p>
            <strong>无需另存管理链接</strong>
            队长账号是当前所有者；需要协作时，可在报名管理页邀请其他账号。
          </p>
        </div>
        <div className={styles.receiptActions}>
          <Link href={receipt.managePath} className={styles.managementLink}>
            管理这份报名 →
          </Link>
          <Link href="/me">查看我的赛事</Link>
        </div>
        {receipt.seatsLeft === null ? null : <small>当前剩余 {receipt.seatsLeft} 个席位</small>}
      </section>
    )
  }

  return (
    <form
      action={submit}
      className={styles.form}
      aria-busy={pending}
      aria-describedby="registration-privacy"
    >
      <p id="registration-privacy" className={styles.privacy}>
        联系方式仅供主办方审核、排期与紧急联络，不会展示在公开参赛名单中。提交前请确认队员已知悉本次报名。
      </p>
      <fieldset disabled={pending} className={styles.fieldset}>
        <div className={styles.pair}>
          <Field
            id="name"
            name="name"
            label="战队名称"
            required
            maxLength={20}
            placeholder="例：临界爆破小队"
            defaultValue={initialValues?.name}
          />
          <Field
            id="tag"
            name="tag"
            label="战队 TAG"
            required
            hint="2–5 字符"
            maxLength={5}
            placeholder="例：FROST"
            defaultValue={initialValues?.tag}
          />
        </div>

        <div className={styles.pair}>
          <Field
            id="captain"
            name="captain"
            label="队长昵称 / 姓名"
            required
            maxLength={20}
            defaultValue={initialValues?.captain}
          />
          <Field
            id="contact"
            name="contact"
            label="联系方式"
            required
            hint="QQ / 微信 / Steam"
            maxLength={40}
            defaultValue={initialValues?.contact}
          />
        </div>

        <Field
          id="dept"
          name="dept"
          label="学院 / 分区"
          maxLength={30}
          placeholder="例：计算机与数据工程学院"
          defaultValue={initialValues?.dept}
        />

        <div className={styles.roster}>
          <div className="readout">首发五人 + 替补一人</div>
          <div className={styles.players}>
            {[1, 2, 3, 4, 5].map(index => (
              <Field
                key={index}
                id={`player${index}`}
                name={`player${index}`}
                label={`首发 ${index}`}
                required
                maxLength={20}
                placeholder="游戏 ID"
                defaultValue={initialValues?.players[index - 1]}
              />
            ))}
            <Field
              id="player6"
              name="player6"
              label="替补"
              maxLength={20}
              placeholder="选填"
              defaultValue={initialValues?.players[5]}
            />
          </div>
        </div>

        <TextField
          id="note"
          name="note"
          label="备注"
          rows={2}
          maxLength={120}
          placeholder="时间冲突、器材需求等（选填）"
          defaultValue={initialValues?.note}
        />

        {error ? (
          <div className={styles.errorBlock}>
            <p
              ref={errorRef}
              className={styles.error}
              role="alert"
              aria-live="assertive"
              tabIndex={-1}
            >
              {error}
            </p>
            {recoveryPath ? <Link href={recoveryPath}>前往处理 →</Link> : null}
          </div>
        ) : null}

        {draftSavedAt ? (
          <p className={styles.draftSaved} role="status" aria-live="polite">
            草稿已保存，可从“我的赛事”继续填写。
          </p>
        ) : null}

        <div className={styles.formActions}>
          <Button type="submit" name="intent" value="draft" formNoValidate>
            {pending ? '保存中…' : '保存草稿'}
          </Button>
          <Button
            type="submit"
            name="intent"
            value="submit"
            variant="primary"
            disabled={!canSubmit}
          >
            {pending ? '提交中…' : canSubmit ? '提交报名' : '通过资格审核后提交'}
          </Button>
        </div>
      </fieldset>
    </form>
  )
}
