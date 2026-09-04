'use client'

import { useState, useTransition } from 'react'
import { Button, Field, TextField } from '@/components/ui'
import { useUnsavedChangesWarning } from '@/components/admin/useUnsavedChangesWarning'
import type { ClubMember } from '@/lib/types'
import { removeMember, updateMember } from '../actions/content'
import styles from '../admin.module.css'

export function MemberEditor({ member }: { member: ClubMember }) {
  const [pending, startTransition] = useTransition()
  const [open, setOpen] = useState(false)
  const [saved, setSaved] = useState(false)
  const [error, setError] = useState('')
  const [dirty, setDirty] = useState(false)

  useUnsavedChangesWarning(
    open && dirty,
    `「${member.name}」还有未保存的更改，离开将丢失这些内容。`,
  )

  const handleDelete = () => {
    if (!confirm(`确定删除「${member.name}」?此操作不可撤销。`)) return
    startTransition(async () => {
      setError('')
      setSaved(false)
      try {
        await removeMember(member.id)
        setDirty(false)
      } catch {
        setError('删除失败，请检查网络后重试。')
      }
    })
  }

  if (!open) {
    return (
      <div className={styles.listRow}>
        <div>
          <div className={styles.listTitle}>{member.role}</div>
          <div className={styles.listMeta}>
            {member.name}
            {member.handle ? ` · ${member.handle}` : ''}
          </div>
        </div>
        <div className={styles.rowActions}>
          {saved ? (
            <span className={styles.ok} role="status">
              已保存
            </span>
          ) : null}
          <Button
            size="mini"
            onClick={() => {
              setDirty(false)
              setError('')
              setOpen(true)
            }}
          >
            编辑
          </Button>
          <Button size="mini" variant="danger" disabled={pending} onClick={handleDelete}>
            删除
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

  return (
    <form
      className={styles.editor}
      style={{ padding: '22px 0', borderBottom: '1px solid var(--line)' }}
      onChange={() => {
        setDirty(true)
        setSaved(false)
        setError('')
      }}
      action={formData =>
        startTransition(async () => {
          setError('')
          setSaved(false)
          try {
            await updateMember(member.id, formData)
            setDirty(false)
            setSaved(true)
            setOpen(false)
          } catch {
            setError('保存失败，请检查网络后重试。')
          }
        })
      }
    >
      <div className={styles.pair}>
        <Field id={`mn${member.id}`} name="name" label="姓名" defaultValue={member.name} required />
        <Field id={`mr${member.id}`} name="role" label="职务" defaultValue={member.role} required />
      </div>
      <div className={styles.pair}>
        <Field
          id={`mh${member.id}`}
          name="handle"
          label="联系方式"
          defaultValue={member.handle ?? ''}
        />
        <Field
          id={`mo${member.id}`}
          name="sortOrder"
          label="显示顺序"
          type="number"
          defaultValue={member.sortOrder}
        />
      </div>
      <TextField
        id={`mi${member.id}`}
        name="intro"
        label="职责"
        rows={2}
        defaultValue={member.intro ?? ''}
      />
      <div className={styles.rowActions}>
        <Button type="submit" variant="primary" disabled={pending}>
          {pending ? '保存中…' : '保存'}
        </Button>
        <Button
          type="button"
          disabled={pending}
          onClick={() => {
            setError('')
            setDirty(false)
            setOpen(false)
          }}
        >
          取消
        </Button>
        <Button
          type="button"
          size="mini"
          variant="danger"
          disabled={pending}
          onClick={handleDelete}
        >
          删除
        </Button>
        {error ? (
          <span className={styles.error} role="alert">
            {error}
          </span>
        ) : null}
      </div>
    </form>
  )
}
