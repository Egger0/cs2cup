'use client'

import { useState, useTransition } from 'react'
import { Button, Field, TextField } from '@/components/ui'
import { useUnsavedChangesWarning } from '@/components/admin/useUnsavedChangesWarning'
import type { Game, Post } from '@/lib/types'
import { removePost, updatePost } from '../actions/content'
import styles from '../admin.module.css'

export function PostEditor({ post, games }: { post: Post; games: Game[] }) {
  const [pending, startTransition] = useTransition()
  const [saved, setSaved] = useState(false)
  const [open, setOpen] = useState(false)
  const [error, setError] = useState('')
  const [dirty, setDirty] = useState(false)

  useUnsavedChangesWarning(open && dirty, `「${post.title}」还有未保存的更改，离开将丢失这些内容。`)

  function handleDelete() {
    if (!confirm(`删除「${post.title}」?`)) return
    startTransition(async () => {
      setError('')
      setSaved(false)
      try {
        await removePost(post.id)
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
          <div className={styles.listTitle}>{post.title}</div>
          <div className={styles.listMeta}>
            {new Date(post.publishedAt).toLocaleDateString('zh-CN')} · /{post.slug}
            {post.pinned ? ' · 置顶' : ''}
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
            await updatePost(post.id, formData)
            setDirty(false)
            setSaved(true)
            setOpen(false)
          } catch {
            setError('保存失败，请检查网络后重试。')
          }
        })
      }
    >
      <Field id={`t${post.id}`} name="title" label="标题" defaultValue={post.title} required />
      <Field id={`s${post.id}`} name="summary" label="摘要" defaultValue={post.summary} required />
      <TextField id={`b${post.id}`} name="body" label="正文" rows={6} defaultValue={post.body} />
      <div className={styles.pair}>
        <label className={styles.controlLabel}>
          关联项目
          <select name="gameId" defaultValue={post.gameId ?? ''} className={styles.select}>
            <option value="">不关联</option>
            {games.map(game => (
              <option key={game.id} value={game.id}>
                {game.name}
              </option>
            ))}
          </select>
        </label>
        <label className={styles.checkLabel}>
          <input type="checkbox" name="pinned" defaultChecked={post.pinned} /> 置顶
        </label>
      </div>
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
        {error ? (
          <span className={styles.error} role="alert">
            {error}
          </span>
        ) : null}
      </div>
    </form>
  )
}
