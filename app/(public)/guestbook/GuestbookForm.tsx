'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { Button, Field, TextField, Toast } from '@/components/ui'
import { submitGuestbookMessage } from './actions'
import styles from './guestbook.module.css'

export function GuestbookForm() {
  const router = useRouter()
  const [error, setError] = useState('')
  const [pending, setPending] = useState(false)
  const [done, setDone] = useState(false)
  const [formKey, setFormKey] = useState(0)

  async function submit(form: FormData) {
    setError('')
    setPending(true)
    try {
      const result = await submitGuestbookMessage(form)
      if (!result.ok) {
        setError(result.error ?? '提交失败，请稍后重试')
        return
      }
      setDone(true)
      setFormKey(key => key + 1)
      router.refresh()
    } catch {
      setError('网络异常，请稍后重试')
    } finally {
      setPending(false)
    }
  }

  return (
    <>
      <form key={formKey} action={submit} className={styles.form}>
        <fieldset disabled={pending} className={styles.fieldset}>
          <Field id="guestbook-name" name="name" label="昵称" required maxLength={32} placeholder="留下你的称呼" />
          <TextField
            id="guestbook-body"
            name="body"
            label="想说的话"
            required
            rows={5}
            maxLength={500}
            placeholder="欢迎分享建议、比赛感受，或想参与的活动。"
          />
          <p className={styles.hint}>留言需要后台审核，通过后才会公开显示。</p>
          {error ? <p className={styles.error} role="alert">{error}</p> : null}
          <Button type="submit" variant="primary">
            {pending ? '提交中…' : '提交留言'}
          </Button>
        </fieldset>
      </form>

      <Toast open={done} title="留言已提交" message="审核通过后会显示在这里。" />
    </>
  )
}
