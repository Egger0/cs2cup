'use client'

import { useState, useTransition } from 'react'
import { Button, Field, TextField } from '@/components/ui'
import type { ClubMember } from '@/lib/types'
import { removeMember, updateMember } from '../_actions'
import styles from '../admin.module.css'

export function MemberEditor({ member }: { member: ClubMember }) {
  const [pending, startTransition] = useTransition()
  const [open, setOpen] = useState(false)
  const [saved, setSaved] = useState(false)

  const handleDelete = () => {
    if (!confirm(`确定删除「${member.name}」?此操作不可撤销。`)) return
    startTransition(() => void removeMember(member.id))
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
          {saved ? <span className={styles.ok}>已保存</span> : null}
          <Button size="mini" onClick={() => setOpen(true)}>
            编辑
          </Button>
          <Button size="mini" variant="danger" disabled={pending} onClick={handleDelete}>
            删除
          </Button>
        </div>
      </div>
    )
  }

  return (
    <form
      className={styles.editor}
      style={{ padding: '22px 0', borderBottom: '1px solid var(--line)' }}
      action={formData =>
        startTransition(async () => {
          await updateMember(member.id, formData)
          setSaved(true)
          setOpen(false)
        })
      }
    >
      <div className={styles.pair}>
        <Field id={`mn${member.id}`} name="name" label="姓名" defaultValue={member.name} required />
        <Field id={`mr${member.id}`} name="role" label="职务" defaultValue={member.role} required />
      </div>
      <div className={styles.pair}>
        <Field id={`mh${member.id}`} name="handle" label="联系方式" defaultValue={member.handle ?? ''} />
        <Field
          id={`mo${member.id}`}
          name="sortOrder"
          label="显示顺序"
          type="number"
          defaultValue={member.sortOrder}
        />
      </div>
      <TextField id={`mi${member.id}`} name="intro" label="职责" rows={2} defaultValue={member.intro ?? ''} />
      <div className={styles.rowActions}>
        <Button type="submit" variant="primary" disabled={pending}>
          {pending ? '保存中…' : '保存'}
        </Button>
        <Button type="button" onClick={() => setOpen(false)}>
          取消
        </Button>
        <Button type="button" size="mini" variant="danger" disabled={pending} onClick={handleDelete}>
          删除
        </Button>
      </div>
    </form>
  )
}
