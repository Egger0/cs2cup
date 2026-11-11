'use client'

import Link from 'next/link'
import { useCallback, useEffect, useOptimistic, useState, useTransition } from 'react'
import { postCommentAction, removeCommentAction, type CommentResult } from '@/app/comments/actions'
import { Button, TextField } from '@/components/ui'
import type { Comment, CommentSubject } from '@/lib/comments'
import { formatSiteNumericDateTime } from '@/lib/datetime'
import { Reactions, type ReactionState } from './Reactions'
import styles from './Comments.module.css'

interface Payload {
  ok: boolean
  viewerId: string | null
  moderator: boolean
  comments: Comment[]
  reactions: ReactionState
  commentReactions: Record<number, ReactionState>
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
  const [comments, applyOptimistic] = useOptimistic(
    data?.comments ?? [],
    (current: Comment[], change: { add: Comment } | { drop: number }) =>
      'add' in change
        ? [...current, change.add]
        : current.filter(comment => comment.id !== change.drop),
  )

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

  const run = (
    action: () => Promise<CommentResult>,
    change?: { add: Comment } | { drop: number },
    after?: () => void,
  ) =>
    startTransition(async () => {
      setError('')
      if (change) applyOptimistic(change)
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
      <header className={styles.head}>
        <h2 id={`comments-${kind}-${id}`}>
          讨论{comments.length ? <span>{comments.length}</span> : null}
        </h2>
        <Reactions kind={kind} id={id} initial={data.reactions} signedIn={Boolean(data.viewerId)} />
      </header>
      {comments.length ? (
        <ol className={styles.thread}>
          {comments.map(comment => (
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
                    onClick={() => run(() => removeCommentAction(comment.id), { drop: comment.id })}
                  >
                    {data.moderator ? '隐藏' : '删除'}
                  </button>
                ) : null}
              </p>
              <p className={styles.body}>{comment.body}</p>
              {comment.hidden || comment.id < 0 ? null : (
                <Reactions
                  kind="comment"
                  id={comment.id}
                  initial={data.commentReactions[comment.id] ?? { counts: {}, mine: null }}
                  signedIn={Boolean(data.viewerId)}
                  compact
                />
              )}
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
              {
                add: {
                  id: -Date.now(),
                  body: body.trim(),
                  authorId: data.viewerId ?? '',
                  authorName: '我',
                  authorHandle: null,
                  hidden: false,
                  createdAt: Date.now(),
                },
              },
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
