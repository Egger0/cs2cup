'use client'

import { useState, useTransition } from 'react'
import { Button, Field, TextField } from '@/components/ui'
import type { Game, Tournament, TournamentStatus } from '@/lib/types'
import { updateTournament } from '../../_actions'
import styles from '../../admin.module.css'

const STATES: { value: TournamentStatus; label: string }[] = [
  { value: 'draft', label: '草稿' },
  { value: 'registration', label: '报名中' },
  { value: 'running', label: '进行中' },
  { value: 'finished', label: '已结束' },
  { value: 'postponed', label: '延期中' },
]

export function TournamentEditor({
  tournament,
  games,
}: {
  tournament: Tournament
  games: Game[]
}) {
  const [pending, startTransition] = useTransition()
  const [saved, setSaved] = useState(false)

  return (
    <form
      className={styles.editor}
      action={formData =>
        startTransition(async () => {
          await updateTournament(tournament.id, formData)
          setSaved(true)
        })
      }
    >
      <div className={styles.pair}>
        <Field id="tt" name="title" label="赛事名称" defaultValue={tournament.title} required />
        <Field id="th" name="heroBottom" label="标题主词" defaultValue={tournament.heroBottom} />
      </div>
      <div className={styles.pair}>
        <label className="readout">
          项目
          <select name="gameId" defaultValue={tournament.gameId ?? ''} className={styles.select}>
            {games.map(game => (
              <option key={game.id} value={game.id}>
                {game.name}
              </option>
            ))}
          </select>
        </label>
        <label className="readout">
          状态
          <select name="status" defaultValue={tournament.status} className={styles.select}>
            {STATES.map(state => (
              <option key={state.value} value={state.value}>
                {state.label}
              </option>
            ))}
          </select>
        </label>
      </div>
      <div className={styles.pair}>
        <Field
          id="tc"
          name="teamCap"
          type="number"
          min={2}
          label="席位数"
          defaultValue={tournament.teamCap}
        />
        <Field id="te" name="heroEyebrow" label="状态文案" defaultValue={tournament.heroEyebrow} />
      </div>
      <TextField id="tl" name="lede" label="一句话介绍" rows={2} defaultValue={tournament.lede} />
      <div className={styles.pair}>
        <Field
          id="tch"
          name="championName"
          label="冠军战队"
          hint="决赛录入后自动填写,可手动覆盖"
          defaultValue={tournament.championName ?? ''}
        />
        <Field
          id="tcn"
          name="championNote"
          label="荣誉备注"
          defaultValue={tournament.championNote ?? ''}
        />
      </div>
      <Field
        id="tm"
        name="mapPool"
        label="地图池"
        hint="用逗号分隔"
        defaultValue={tournament.mapPool.join(',')}
      />
      <div className={styles.rowActions}>
        <Button type="submit" variant="primary" disabled={pending}>
          {pending ? '保存中…' : '保存'}
        </Button>
        {saved ? <span className={styles.ok}>已保存</span> : null}
      </div>
    </form>
  )
}
