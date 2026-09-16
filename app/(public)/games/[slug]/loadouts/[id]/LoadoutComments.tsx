'use client'

import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { useState, useTransition } from 'react'
import { Button, TextField } from '@/components/ui'
import { formatSiteNumericDateTime } from '@/lib/datetime'
import type { LoadoutComment } from '@/lib/loadout-community'
import { postLoadoutCommentAction, removeLoadoutCommentAction } from '../actions'
import styles from './detail.module.css'

export function LoadoutComments({
  slug,
  codeId,
  comments,
  viewerId,
  moderator,
  open,
}: {
  slug: string
  codeId: number
  comments: readonly LoadoutComment[]
  viewerId: string | null
  moderator: boolean
  open: boolean
}) {
  const router = useRouter()
  const [pending, startTransition] = useTransition()
  const [body, setBody] = useState('')
  const [error, setError] = useState('')

  const run = (action: () => Promise<{ ok: boolean; error?: string }>, after?: () => void) =>
    startTransition(async () => {
      setError('')
      const result = await action().catch(() => ({ ok: false, error: '网络异常，请稍后重试。' }))
      if (!result.ok) return setError(result.error ?? '操作失败')
      after?.()
      router.refresh()
    })

  return (
    <div className={styles.comments} aria-busy={pending}>
      {comments.length ? (
        <ol className={styles.thread}>
          {comments.map(comment => (
            <li key={comment.id} data-hidden={comment.hidden ? '' : undefined}>
              <p className={styles.commentMeta}>
                {comment.authorHandle ? (
                  <Link href={`/players/${comment.authorHandle}`}>{comment.authorName}</Link>
                ) : (
                  <b>{comment.authorName}</b>
                )}
                <time dateTime={new Date(comment.createdAt).toISOString()}>
                  {formatSiteNumericDateTime(comment.createdAt)}
                </time>
                {comment.hidden ? <span>已隐藏</span> : null}
                {!comment.hidden && (moderator || comment.authorId === viewerId) ? (
                  <button
                    type="button"
                    disabled={pending}
                    onClick={() => run(() => removeLoadoutCommentAction(slug, codeId, comment.id))}
                  >
                    {moderator ? '隐藏' : '删除'}
                  </button>
                ) : null}
              </p>
              <p className={styles.commentBody}>{comment.body}</p>
            </li>
          ))}
        </ol>
      ) : (
        <p className={styles.quiet}>还没有人留言，来说说你的使用感受。</p>
      )}

      {!open ? null : viewerId ? (
        <form
          className={styles.commentForm}
          action={() =>
            run(
              () => postLoadoutCommentAction(slug, codeId, body),
              () => setBody(''),
            )
          }
        >
          <TextField
            id="loadout-comment"
            name="body"
            label="留言"
            rows={3}
            maxLength={300}
            required
            value={body}
            onChange={event => setBody(event.target.value)}
            hint={`${[...body].length}/300`}
            error={error || undefined}
          />
          <Button type="submit" variant="primary" disabled={pending || !body.trim()}>
            {pending ? '正在发送…' : '发表留言'}
          </Button>
        </form>
      ) : (
        <p className={styles.quiet}>
          <Link href="/login">登录</Link>后参与交流。
        </p>
      )}
    </div>
  )
}
