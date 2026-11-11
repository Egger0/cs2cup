'use client'

import { useRef } from 'react'
import { createSquadAction } from './actions'
import { SquadFeedback } from './SquadFeedback'
import styles from './squads.module.css'
import { useSquadAction } from './useSquadAction'

export function CreateSquadForm({
  games,
  fixed = false,
}: {
  games: { id: number; name: string; rosterSize: number }[]
  fixed?: boolean
}) {
  const form = useRef<HTMLFormElement>(null)
  const { pending, feedback, run } = useSquadAction()

  return (
    <section className={styles.create} aria-labelledby="create-squad-title">
      <header>
        <h2 id="create-squad-title">组一支战队</h2>
        <p>
          创建后你就是队长。队友可以邀请账号加入，也可以先填游戏 ID
          占位；战队会保留，下次报名直接用。
        </p>
      </header>
      <form
        ref={form}
        className={styles.createForm}
        aria-busy={pending}
        action={data =>
          run(
            () => createSquadAction(data),
            () => form.current?.reset(),
          )
        }
      >
        {fixed ? (
          <input type="hidden" name="gameId" value={games[0]?.id} />
        ) : (
          <label>
            <span>项目</span>
            <select name="gameId" required defaultValue={games[0]?.id}>
              {games.map(game => (
                <option key={game.id} value={game.id}>
                  {game.name} · {game.rosterSize} 人一队
                </option>
              ))}
            </select>
          </label>
        )}
        <label>
          <span>战队名称</span>
          <input name="name" required maxLength={20} placeholder="例：夜鸦" />
        </label>
        <label>
          <span>TAG</span>
          <input
            name="tag"
            required
            minLength={2}
            maxLength={5}
            pattern="[A-Za-z0-9]{2,5}"
            placeholder="RAVN"
            autoCapitalize="characters"
          />
        </label>
        {fixed ? (
          <fieldset className={styles.guests}>
            <legend>队友的游戏 ID（选填，之后也可以邀请账号）</legend>
            {Array.from({ length: Math.max(0, (games[0]?.rosterSize ?? 1) - 1) }, (_, index) => (
              <input
                key={index}
                name="guest"
                maxLength={20}
                aria-label={`队友 ${index + 1}`}
                placeholder={`队友 ${index + 1}`}
              />
            ))}
          </fieldset>
        ) : null}
        <button type="submit" className={styles.primaryButton} disabled={pending}>
          {pending ? '创建中…' : '创建战队'}
        </button>
      </form>
      <SquadFeedback feedback={feedback} />
    </section>
  )
}
