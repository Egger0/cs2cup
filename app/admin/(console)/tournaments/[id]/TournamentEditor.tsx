'use client'

import { useState, useTransition } from 'react'
import { Button, Field, TextField } from '@/components/ui'
import { useUnsavedChangesWarning } from '@/components/admin/useUnsavedChangesWarning'
import { d1UtcTimestampToIso, isoToDateTimeLocal } from '@/lib/datetime'
import { TOURNAMENT_FORM_LIMITS } from '@/lib/tournament-form-validation'
import type { Game, Tournament, TournamentStatus } from '@/lib/types'
import { updateTournament } from '../../actions/tournaments'
import styles from '../../admin.module.css'

const STATES: { value: TournamentStatus; label: string }[] = [
  { value: 'draft', label: '草稿' },
  { value: 'registration', label: '报名中' },
  { value: 'running', label: '进行中' },
  { value: 'finished', label: '已结束' },
  { value: 'postponed', label: '延期中' },
]
const UNSAVED_MESSAGE = '赛事设置还有未保存的更改，离开将丢失这些内容。'

function localDateTime(value: string | null) {
  if (!value) return ''
  return isoToDateTimeLocal(value) ?? isoToDateTimeLocal(d1UtcTimestampToIso(value) ?? '') ?? ''
}

export function TournamentEditor({ tournament, games }: { tournament: Tournament; games: Game[] }) {
  const [pending, startTransition] = useTransition()
  const [feedback, setFeedback] = useState<{ ok: boolean; message: string } | null>(null)
  const [dirty, setDirty] = useState(false)

  useUnsavedChangesWarning(dirty, UNSAVED_MESSAGE)

  return (
    <form
      className={styles.editor}
      onChange={() => {
        setDirty(true)
        setFeedback(null)
      }}
      action={formData =>
        startTransition(async () => {
          setFeedback(null)
          try {
            const result = await updateTournament(tournament.id, formData)
            setFeedback({
              ok: result.ok,
              message: result.ok ? '已保存' : (result.error ?? '赛事保存失败'),
            })
            if (result.ok) setDirty(false)
          } catch {
            setFeedback({ ok: false, message: '网络异常，赛事未保存' })
          }
        })
      }
    >
      <fieldset className={styles.formSection}>
        <legend>01 / 基本信息</legend>
        <div className={styles.pair}>
          <Field
            id="tt"
            name="title"
            label="赛事名称"
            maxLength={TOURNAMENT_FORM_LIMITS.title}
            defaultValue={tournament.title}
            required
          />
          <Field
            id="th"
            name="heroBottom"
            label="标题主词"
            maxLength={TOURNAMENT_FORM_LIMITS.heroBottom}
            defaultValue={tournament.heroBottom}
          />
        </div>
        <div className={styles.pair}>
          <label className={styles.controlLabel}>
            项目
            <select name="gameId" defaultValue={tournament.gameId ?? ''} className={styles.select}>
              {games.map(game => (
                <option key={game.id} value={game.id}>
                  {game.name}
                </option>
              ))}
            </select>
          </label>
          <label className={styles.controlLabel}>
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
            max={TOURNAMENT_FORM_LIMITS.teamCap}
            label="席位数"
            defaultValue={tournament.teamCap}
          />
          <Field
            id="te"
            name="heroEyebrow"
            label="状态文案"
            maxLength={TOURNAMENT_FORM_LIMITS.heroEyebrow}
            defaultValue={tournament.heroEyebrow}
          />
        </div>
        <TextField
          id="tl"
          name="lede"
          label="一句话介绍"
          rows={2}
          maxLength={TOURNAMENT_FORM_LIMITS.lede}
          defaultValue={tournament.lede}
        />
      </fieldset>

      <fieldset className={styles.formSection}>
        <legend>02 / 赛期与荣誉</legend>
        <div className={styles.pair}>
          <Field
            id="trd"
            name="regDeadline"
            type="datetime-local"
            label="报名截止（北京时间）"
            defaultValue={localDateTime(tournament.regDeadline)}
          />
          <Field
            id="tsa"
            name="startsAt"
            type="datetime-local"
            label="开赛时间（北京时间）"
            defaultValue={localDateTime(tournament.startsAt)}
          />
        </div>
        <div className={styles.pair}>
          <Field
            id="tch"
            name="championName"
            label="冠军战队"
            hint="决赛录入后自动填写,可手动覆盖"
            maxLength={TOURNAMENT_FORM_LIMITS.championName}
            defaultValue={tournament.championName ?? ''}
          />
          <Field
            id="tcn"
            name="championNote"
            label="荣誉备注"
            maxLength={TOURNAMENT_FORM_LIMITS.championNote}
            defaultValue={tournament.championNote ?? ''}
          />
        </div>
      </fieldset>

      <fieldset className={styles.formSection}>
        <legend>03 / 规则与公开内容</legend>
        <Field
          id="tm"
          name="mapPool"
          label="地图池"
          hint="用逗号分隔"
          maxLength={TOURNAMENT_FORM_LIMITS.mapPoolText}
          defaultValue={tournament.mapPool.join(',')}
        />
        <TextField
          id="tr"
          name="rules"
          label="赛事规则（JSON）"
          hint="数组每项包含 label、title、body"
          rows={8}
          maxLength={TOURNAMENT_FORM_LIMITS.collectionText}
          spellCheck={false}
          defaultValue={JSON.stringify(tournament.rules, null, 2)}
        />
        <TextField
          id="tf"
          name="faqs"
          label="常见问题（JSON）"
          hint="数组每项包含 question、answer"
          rows={8}
          maxLength={TOURNAMENT_FORM_LIMITS.collectionText}
          spellCheck={false}
          defaultValue={JSON.stringify(tournament.faqs, null, 2)}
        />
      </fieldset>

      <div className={styles.saveBar} data-dirty={dirty || undefined}>
        <Button type="submit" variant="primary" disabled={pending || !dirty}>
          {pending ? '保存中…' : dirty ? '保存更改' : '已同步'}
        </Button>
        {feedback ? (
          <span
            className={feedback.ok ? styles.ok : styles.error}
            role={feedback.ok ? 'status' : 'alert'}
          >
            {feedback.message}
          </span>
        ) : null}
      </div>
    </form>
  )
}
