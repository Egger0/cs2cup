'use client'

import { useRef } from 'react'
import { createSquadAction } from './actions'
import { SquadFeedback } from './SquadFeedback'
import styles from './squads.module.css'
import { useSquadAction } from './useSquadAction'

export function CreateSquadForm({
  games,
}: {
  games: { id: number; name: string; rosterSize: number }[]
}) {
  const form = useRef<HTMLFormElement>(null)
  const { pending, feedback, run } = useSquadAction()

  return (
    <section className={styles.create} aria-labelledby="create-squad-title">
      <header>
        <span className={styles.eyebrow}>NEW SQUAD / 新建小队</span>
        <h2 id="create-squad-title">组一支小队</h2>
        <p>创建后你就是队长。邀请队友加入，满员后可以直接报名这个项目的赛事。</p>
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
        <label>
          <span>小队名称</span>
          <input name="name" required maxLength={20} placeholder="例：夜鸦小队" />
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
        <button type="submit" className={styles.primaryButton} disabled={pending}>
          {pending ? '创建中…' : '创建小队'}
        </button>
      </form>
      <SquadFeedback feedback={feedback} />
    </section>
  )
}
