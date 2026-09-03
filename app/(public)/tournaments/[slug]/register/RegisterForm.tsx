'use client'

import Link from 'next/link'
import { useEffect, useRef, useState } from 'react'
import { Button, Field, TextField } from '@/components/ui'
import { registerTeam } from './actions'
import styles from './register.module.css'

async function writeClipboard(value: string) {
  try {
    await navigator.clipboard.writeText(value)
    return true
  } catch {
    const field = document.createElement('textarea')
    field.value = value
    field.setAttribute('aria-hidden', 'true')
    field.style.position = 'fixed'
    field.style.opacity = '0'
    document.body.append(field)
    field.select()
    try {
      return document.execCommand('copy')
    } catch {
      return false
    } finally {
      field.remove()
    }
  }
}

export function RegisterForm({
  slug,
  disabled,
  siteOrigin,
}: {
  slug: string
  disabled: boolean
  siteOrigin: string
}) {
  const [error, setError] = useState('')
  const [recoveryPath, setRecoveryPath] = useState<string | null>(null)
  const [pending, setPending] = useState(false)
  const [receipt, setReceipt] = useState<{ url: string; seatsLeft: number | null } | null>(null)
  const [copyState, setCopyState] = useState<'idle' | 'copied' | 'failed'>('idle')
  const errorRef = useRef<HTMLParagraphElement>(null)
  const receiptTitleRef = useRef<HTMLHeadingElement>(null)

  useEffect(() => {
    if (error) errorRef.current?.focus()
  }, [error])

  useEffect(() => {
    if (receipt) receiptTitleRef.current?.focus()
  }, [receipt])

  async function copyManagementLink() {
    if (!receipt) return
    setCopyState((await writeClipboard(receipt.url)) ? 'copied' : 'failed')
  }

  async function submit(form: FormData) {
    setError('')
    setRecoveryPath(null)
    setPending(true)
    try {
      const result = await registerTeam(slug, form)
      if (!result.ok) {
        setError(result.error ?? '提交失败，请稍后重试')
        setRecoveryPath(result.redirectTo ?? null)
        return
      }
      if (!result.managementPath) {
        setError('报名已提交，但管理链接生成失败；请立即联系赛事负责人')
        return
      }
      setReceipt({
        url: new URL(result.managementPath, siteOrigin).href,
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
        <p>先保存下面的专属链接；审核状态和阵容修改都通过它完成。</p>
        <p className={styles.receiptWarning}>此链接等同于战队管理凭证，请勿转发给无关人员。</p>
        <div className={styles.passHandoff}>
          <span aria-hidden="true">PASS / NEXT</span>
          <p>
            <strong>继续设置赛事通行证</strong>
            已有通行证可把这份报名加入“我的赛事”；首次使用也可在下一页创建。
          </p>
        </div>
        <div className={styles.receiptActions}>
          <Link href={receipt.url} prefetch={false} className={styles.managementLink}>
            打开报名回执，继续设置 →
          </Link>
          <Button type="button" size="mini" onClick={copyManagementLink}>
            复制管理链接
          </Button>
        </div>
        {copyState === 'idle' ? null : (
          <small role="status" aria-live="polite">
            {copyState === 'copied'
              ? '管理链接已复制到剪贴板。'
              : '复制失败，请打开链接后从地址栏复制。'}
          </small>
        )}
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
      <fieldset disabled={disabled || pending} className={styles.fieldset}>
        <div className={styles.pair}>
          <Field
            id="name"
            name="name"
            label="战队名称"
            required
            maxLength={20}
            placeholder="例：临界爆破小队"
          />
          <Field
            id="tag"
            name="tag"
            label="战队 TAG"
            required
            hint="2–5 字符"
            maxLength={5}
            placeholder="例：FROST"
          />
        </div>

        <div className={styles.pair}>
          <Field id="captain" name="captain" label="队长昵称 / 姓名" required maxLength={20} />
          <Field
            id="contact"
            name="contact"
            label="联系方式"
            required
            hint="QQ / 微信 / Steam"
            maxLength={40}
          />
        </div>

        <Field
          id="dept"
          name="dept"
          label="学院 / 分区"
          maxLength={30}
          placeholder="例：计算机与数据工程学院"
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
              />
            ))}
            <Field id="player6" name="player6" label="替补" maxLength={20} placeholder="选填" />
          </div>
        </div>

        <TextField
          id="note"
          name="note"
          label="备注"
          rows={2}
          maxLength={120}
          placeholder="时间冲突、器材需求等（选填）"
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

        <Button type="submit" variant="primary">
          {pending ? '提交中…' : disabled ? '席位已满' : '提交报名'}
        </Button>
      </fieldset>
    </form>
  )
}
