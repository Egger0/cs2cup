'use client'

import { useState, useTransition } from 'react'
import { Button, Field, TextField } from '@/components/ui'
import type { Game } from '@/lib/types'
import { removeGame, updateGame } from '../_actions'
import styles from '../admin.module.css'

export function GameEditor({ game }: { game: Game }) {
  const [pending, startTransition] = useTransition()
  const [open, setOpen] = useState(false)
  const [saved, setSaved] = useState(false)
  const [error, setError] = useState('')

  const handleDelete = () => {
    if (!confirm(`确定删除「${game.name}」?此操作不可撤销。`)) return
    startTransition(async () => {
      setError('')
      const result = await removeGame(game.id)
      if (!result.ok) setError(result.error)
    })
  }

  if (!open) {
    return (
      <div className={styles.listRow}>
        <div>
          <div className={styles.listTitle}>
            <span style={{ color: game.accentColor ?? 'var(--t)' }}>■</span> {game.name}
          </div>
          <div className={styles.listMeta}>
            /{game.slug} · {game.nameEn ?? '无英文名'} · {game.active ? '展示中' : '已隐藏'}
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
          {error ? <span className={styles.error}>{error}</span> : null}
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
          await updateGame(game.id, formData)
          setSaved(true)
          setOpen(false)
        })
      }
    >
      <div className={styles.pair}>
        <Field id={`gn${game.id}`} name="name" label="中文名" defaultValue={game.name} required />
        <Field id={`ge${game.id}`} name="nameEn" label="英文名" defaultValue={game.nameEn ?? ''} />
      </div>
      <div className={styles.pair}>
        <Field
          id={`ga${game.id}`}
          name="accentColor"
          label="强调色"
          hint="十六进制,如 #e3a63a"
          defaultValue={game.accentColor ?? ''}
        />
        <label className="readout" style={{ alignSelf: 'end', paddingBottom: 12 }}>
          <input type="checkbox" name="active" defaultChecked={game.active} /> 在网站上展示
        </label>
      </div>
      <Field id={`gt${game.id}`} name="tagline" label="一句话介绍" defaultValue={game.tagline ?? ''} />
      <TextField
        id={`gd${game.id}`}
        name="description"
        label="项目说明"
        rows={4}
        defaultValue={game.description ?? ''}
      />
      <Field
        id={`gf${game.id}`}
        name="formatNote"
        label="社团赛制"
        defaultValue={game.formatNote ?? ''}
      />
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
        {error ? <span className={styles.error}>{error}</span> : null}
      </div>
    </form>
  )
}
