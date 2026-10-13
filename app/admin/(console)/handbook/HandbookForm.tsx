'use client'

import { useRef, useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { Button, Field, TextField } from '@/components/ui'
import { HANDBOOK_ACCEPT, HANDBOOK_MAX_BYTES } from '@/lib/handbook-file'
import { createHandbookDocument } from '../actions/handbook'
import styles from '../admin.module.css'

const EMPTY_FILE = '尚未选择文件'

export function HandbookForm() {
  const router = useRouter()
  const formRef = useRef<HTMLFormElement>(null)
  const [pending, startTransition] = useTransition()
  const [fileName, setFileName] = useState(EMPTY_FILE)
  const [tooLarge, setTooLarge] = useState(false)
  const [feedback, setFeedback] = useState<{ ok: boolean; message: string } | null>(null)

  return (
    <form
      ref={formRef}
      className={styles.editor}
      aria-busy={pending}
      onSubmit={event => {
        event.preventDefault()
        const formData = new FormData(event.currentTarget)
        startTransition(async () => {
          setFeedback(null)
          try {
            const result = await createHandbookDocument(formData)
            if (!result.ok) {
              setFeedback({ ok: false, message: result.error })
              return
            }
            formRef.current?.reset()
            setFileName(EMPTY_FILE)
            setFeedback({ ok: true, message: '已公开' })
            router.refresh()
          } catch {
            setFeedback({ ok: false, message: '保存失败，请检查网络后重试。' })
          }
        })
      }}
    >
      <div className={styles.pair}>
        <label className={styles.controlLabel}>
          类别
          <select name="kind" required className={styles.select} disabled={pending}>
            <option value="handbook">赛事手册</option>
            <option value="template">办赛模板</option>
          </select>
        </label>
        <Field id="hb-title" name="title" label="标题" required maxLength={80} disabled={pending} />
      </div>
      <TextField
        id="hb-summary"
        name="summary"
        label="简介"
        hint="选填，说明它解决什么问题"
        maxLength={300}
        rows={2}
        disabled={pending}
      />
      <label className={styles.controlLabel}>
        文档文件
        <span className={styles.filePicker}>
          <input
            type="file"
            name="file"
            accept={HANDBOOK_ACCEPT}
            disabled={pending}
            className={styles.fileInput}
            onChange={event => {
              const file = event.currentTarget.files?.[0]
              const invalid = Boolean(file && file.size > HANDBOOK_MAX_BYTES)
              setFileName(file?.name ?? EMPTY_FILE)
              setTooLarge(invalid)
              setFeedback(invalid ? { ok: false, message: '文件不要超过 10 MB' } : null)
            }}
          />
          <span className={styles.fileAction}>选择文件</span>
          <span className={styles.fileName}>{fileName}</span>
        </span>
      </label>
      <Field
        id="hb-url"
        name="url"
        type="url"
        label="或者填外部链接"
        hint="腾讯文档、飞书等，和文件二选一"
        placeholder="https://"
        disabled={pending}
      />
      <div className={styles.rowActions}>
        <Button type="submit" variant="primary" disabled={pending || tooLarge}>
          {pending ? '保存中…' : '公开文档'}
        </Button>
        {feedback ? (
          <span
            className={feedback.ok ? styles.ok : styles.error}
            role={feedback.ok ? 'status' : 'alert'}
          >
            {feedback.message}
          </span>
        ) : null}
      </div>
    </form>
  )
}
