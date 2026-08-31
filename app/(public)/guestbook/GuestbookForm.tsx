'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { Button, Field, TextField, Toast } from '@/components/ui'
import { submitGuestbookMessage } from './actions'
import styles from './guestbook.module.css'

export function GuestbookForm({ parentId = null }: { parentId?: number | null }) {
  const router = useRouter()
  const replying = parentId !== null
  const idSuffix = parentId ?? 'root'
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
          {replying ? <input type="hidden" name="parentId" value={parentId} /> : null}
          <Field
            id={`guestbook-name-${idSuffix}`}
            name="name"
            label="昵称"
            required
            maxLength={32}
            placeholder="留下你的称呼"
          />
          <TextField
            id={`guestbook-body-${idSuffix}`}
            name="body"
            label={replying ? '回复内容' : '想说的话'}
            required
            rows={replying ? 3 : 5}
            maxLength={500}
            placeholder={replying ? '友善地参与讨论。' : '欢迎分享建议、比赛感受，或想参与的活动。'}
          />
          <p className={styles.hint}>
            {replying ? '回复' : '留言'}提交后会立即公开；不符合规范的内容可能被管理员删除。
          </p>
          {error ? (
            <p className={styles.error} role="alert">
              {error}
            </p>
          ) : null}
          <Button type="submit" variant="primary">
            {pending ? '提交中…' : replying ? '提交回复' : '提交留言'}
          </Button>
        </fieldset>
      </form>

      <Toast
        open={done}
        title={replying ? '回复已发布' : '留言已发布'}
        message="现在可以在留言板中看到。"
      />
    </>
  )
}
