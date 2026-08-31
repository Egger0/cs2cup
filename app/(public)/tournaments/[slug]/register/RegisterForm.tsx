'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { Button, Field, TextField, Toast } from '@/components/ui'
import { registerTeam } from './actions'
import styles from './register.module.css'

export function RegisterForm({ slug, disabled }: { slug: string; disabled: boolean }) {
  const router = useRouter()
  const [error, setError] = useState('')
  const [pending, setPending] = useState(false)
  const [done, setDone] = useState(false)

  async function submit(form: FormData) {
    setError('')
    setPending(true)
    try {
      const result = await registerTeam(slug, form)
      if (!result.ok) {
        setError(result.error ?? '提交失败,请稍后重试')
        return
      }
      setDone(true)
      router.refresh()
    } catch {
      setError('网络异常,请稍后重试')
    } finally {
      setPending(false)
    }
  }

  return (
    <>
      <form action={submit} className={styles.form}>
        <fieldset disabled={disabled || pending} className={styles.fieldset}>
          <div className={styles.pair}>
            <Field
              id="name"
              name="name"
              label="战队名称"
              required
              maxLength={20}
              placeholder="例:临界爆破小队"
            />
            <Field
              id="tag"
              name="tag"
              label="战队 TAG"
              required
              hint="2–5 字符"
              maxLength={5}
              placeholder="例:FROST"
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
            placeholder="例:计算机与数据工程学院"
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
            placeholder="时间冲突、器材需求等(选填)"
          />

          {error ? <p className={styles.error}>{error}</p> : null}

          <Button type="submit" variant="primary">
            {pending ? '提交中…' : disabled ? '席位已满' : '提交报名'}
          </Button>
        </fieldset>
      </form>

      <Toast open={done} title="报名已提交" message="等待主办方审核" />
    </>
  )
}
