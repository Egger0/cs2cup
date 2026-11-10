'use client'

import Link from 'next/link'
import { useCallback, useEffect, useState, useTransition } from 'react'
import { postCommentAction, removeCommentAction, type CommentResult } from '@/app/comments/actions'
import { Button, TextField } from '@/components/ui'
import type { Comment, CommentSubject } from '@/lib/comments'
import { formatSiteNumericDateTime } from '@/lib/datetime'
import styles from './Comments.module.css'

interface Payload {
  ok: boolean
  viewerId: string | null
  moderator: boolean
  comments: Comment[]
}

export function Comments({
  kind,
  id,
  prompt,
}: {
  kind: CommentSubject
  id: number
  prompt: string
}) {
  const [data, setData] = useState<Payload | null>(null)
  const [pending, startTransition] = useTransition()
  const [body, setBody] = useState('')
  const [error, setError] = useState('')

  const load = useCallback(
    () =>
      fetch(`/api/comments?kind=${kind}&id=${id}`, { cache: 'no-store' })
        .then(response => response.json() as Promise<Payload>)
        .then(payload => setData(payload.ok ? payload : null))
        .catch(() => setData(null)),
    [kind, id],
  )

  useEffect(() => {
    void load()
  }, [load])

  if (!data) return null

  const run = (action: () => Promise<CommentResult>, after?: () => void) =>
    startTransition(async () => {
      setError('')
      const result = await action().catch(
        (): CommentResult => ({ ok: false, error: '网络异常，请稍后重试。' }),
      )
      if (!result.ok) return setError(result.error)
      after?.()
      await load()
    })

  return (
    <section
      className={styles.comments}
      aria-labelledby={`comments-${kind}-${id}`}
      aria-busy={pending}
    >
      <h2 id={`comments-${kind}-${id}`}>讨论 · {data.comments.length}</h2>
      {data.comments.length ? (
        <ol className={styles.thread}>
          {data.comments.map(comment => (
            <li key={comment.id} data-hidden={comment.hidden ? '' : undefined}>
              <p className={styles.meta}>
                {comment.authorHandle ? (
                  <Link href={`/players/${comment.authorHandle}`}>{comment.authorName}</Link>
                ) : (
                  <b>{comment.authorName}</b>
                )}
                <time dateTime={new Date(comment.createdAt).toISOString()}>
                  {formatSiteNumericDateTime(comment.createdAt)}
                </time>
                {comment.hidden ? <span>已隐藏</span> : null}
                {!comment.hidden && (data.moderator || comment.authorId === data.viewerId) ? (
                  <button
                    type="button"
                    disabled={pending}
                    onClick={() => run(() => removeCommentAction(comment.id))}
                  >
                    {data.moderator ? '隐藏' : '删除'}
                  </button>
                ) : null}
              </p>
              <p className={styles.body}>{comment.body}</p>
            </li>
          ))}
        </ol>
      ) : (
        <p className={styles.quiet}>{prompt}</p>
      )}
      {data.viewerId ? (
        <form
          className={styles.form}
          action={() =>
            run(
              () => postCommentAction(kind, id, body),
              () => setBody(''),
            )
          }
        >
          <TextField
            id={`comment-${kind}-${id}`}
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
          <Link href="/login">登录</Link>后参与讨论。
        </p>
      )}
    </section>
  )
}
