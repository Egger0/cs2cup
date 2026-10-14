'use client'

import { useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { Button } from '@/components/ui'
import type { HandbookDocument } from '@/lib/handbook'
import { formatFileSize } from '@/lib/handbook-file'
import { removeHandbookDocument } from '../actions/handbook'
import styles from '../admin.module.css'

const KIND_LABEL = { handbook: '赛事手册', template: '办赛模板' }

export function HandbookRow({
  document,
  projectName,
}: {
  document: HandbookDocument
  projectName: string
}) {
  const router = useRouter()
  const [pending, startTransition] = useTransition()
  const [error, setError] = useState('')

  return (
    <div className={styles.listRow}>
      <div>
        <div className={styles.listTitle}>{document.title}</div>
        <div className={styles.listMeta}>
          {projectName} · {KIND_LABEL[document.kind]} ·{' '}
          {document.fileName
            ? `${document.fileName} · ${formatFileSize(document.byteSize ?? 0)}`
            : document.url}
        </div>
      </div>
      <div className={styles.rowActions}>
        <Button
          size="mini"
          variant="danger"
          disabled={pending}
          aria-busy={pending}
          onClick={() => {
            if (!confirm(`删除「${document.title}」？文件也会一并移除。`)) return
            startTransition(async () => {
              setError('')
              try {
                const result = await removeHandbookDocument(document.id)
                if (result.ok) router.refresh()
                else setError(result.error)
              } catch {
                setError('删除失败，请检查网络后重试。')
              }
            })
          }}
        >
          {pending ? '删除中…' : '删除'}
        </Button>
        {error ? (
          <span className={styles.error} role="alert">
            {error}
          </span>
        ) : null}
      </div>
    </div>
  )
}
