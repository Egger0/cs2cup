'use client'

import { useRouter } from 'next/navigation'
import { useState, useTransition } from 'react'
import { Button, Field, TextField } from '@/components/ui'
import type { ManagedRegistrationTeam } from '@/lib/queries/registration-management'
import { updateAccountRegistration } from '@/app/me/registrations/actions'
import { updateManagedRegistration } from './actions'
import styles from './management.module.css'

function playerValues(team: ManagedRegistrationTeam) {
  const starters = team.players.filter(player => !player.isSubstitute)
  const substitute = team.players.find(player => player.isSubstitute)
  return [
    ...Array.from({ length: 5 }, (_, index) => starters[index]?.nickname ?? ''),
    substitute?.nickname ?? '',
  ]
}

type RegistrationManagerProps = {
  team: ManagedRegistrationTeam
  revision: number
} & ({ access: 'account'; teamId: number } | { access: 'legacy'; slug: string; token: string })

export function RegistrationManager(props: RegistrationManagerProps) {
  const router = useRouter()
  const { team, revision: initialRevision } = props
  const [pending, startTransition] = useTransition()
  const [feedback, setFeedback] = useState<{ ok: boolean; message: string } | null>(null)
  const [revision, setRevision] = useState(initialRevision)
  const players = playerValues(team)

  return (
    <form
      className={styles.form}
      action={form => {
        setFeedback(null)
        startTransition(async () => {
          try {
            const result =
              props.access === 'account'
                ? await updateAccountRegistration(props.teamId, revision, form)
                : await updateManagedRegistration(props.slug, props.token, revision, form)
            if (result.ok && result.revision !== undefined) {
              setRevision(result.revision)
              if (props.access === 'account') router.refresh()
            }
            setFeedback({
              ok: result.ok,
              message: result.ok ? '报名信息已更新' : (result.error ?? '更新失败'),
            })
          } catch {
            setFeedback({ ok: false, message: '网络异常，报名信息未更新' })
          }
        })
      }}
    >
      <div className={styles.pair}>
        <Field
          id="managed-name"
          name="name"
          label="战队名称"
          defaultValue={team.name}
          required
          maxLength={20}
        />
        <Field
          id="managed-tag"
          name="tag"
          label="战队 TAG"
          defaultValue={team.tag}
          required
          maxLength={5}
        />
      </div>
      <div className={styles.pair}>
        <Field
          id="managed-captain"
          name="captain"
          label="队长昵称 / 姓名"
          defaultValue={team.captain}
          required
          maxLength={20}
        />
        <Field
          id="managed-contact"
          name="contact"
          label="联系方式"
          defaultValue={team.contact}
          required
          maxLength={40}
        />
      </div>
      <Field
        id="managed-dept"
        name="dept"
        label="学院 / 分区"
        defaultValue={team.dept ?? ''}
        maxLength={30}
      />
      <fieldset className={styles.roster}>
        <legend className="readout">首发五人 + 替补一人</legend>
        <div className={styles.players}>
          {players.map((nickname, index) => (
            <Field
              key={index}
              id={`managed-player${index + 1}`}
              name={`player${index + 1}`}
              label={index === 5 ? '替补' : `首发 ${index + 1}`}
              defaultValue={nickname}
              required={index < 5}
              maxLength={20}
            />
          ))}
        </div>
      </fieldset>
      <TextField
        id="managed-note"
        name="note"
        label="备注"
        defaultValue={team.note ?? ''}
        rows={2}
        maxLength={120}
      />
      <div className={styles.actions}>
        <Button type="submit" variant="primary" disabled={pending}>
          {pending ? '保存中…' : '保存报名信息'}
        </Button>
        {feedback ? (
          <p
            className={feedback.ok ? styles.success : styles.error}
            role={feedback.ok ? 'status' : 'alert'}
          >
            {feedback.message}
          </p>
        ) : null}
      </div>
    </form>
  )
}
