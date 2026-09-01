'use client'

import { useState, useTransition } from 'react'
import { Button, Field, TextField } from '@/components/ui'
import type { Game, Post } from '@/lib/types'
import { removePost, updatePost } from '../actions/content'
import styles from '../admin.module.css'

export function PostEditor({ post, games }: { post: Post; games: Game[] }) {
  const [pending, startTransition] = useTransition()
  const [saved, setSaved] = useState(false)
  const [open, setOpen] = useState(false)

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
          <Button size="mini" onClick={() => setOpen(true)}>
            编辑
          </Button>
          <Button
            size="mini"
            variant="danger"
            disabled={pending}
            onClick={() => {
              if (!confirm(`删除「${post.title}」?`)) return
              startTransition(() => void removePost(post.id))
            }}
          >
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
          await updatePost(post.id, formData)
          setSaved(true)
          setOpen(false)
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
        <Button type="button" onClick={() => setOpen(false)}>
          取消
        </Button>
      </div>
    </form>
  )
}
