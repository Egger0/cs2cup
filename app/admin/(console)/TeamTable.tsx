'use client'

import { useRouter } from 'next/navigation'
import { useState, useTransition } from 'react'
import { Badge, Button, Empty } from '@/components/ui'
import type { Team, TeamStatus } from '@/lib/types'
import { deleteTeam, updateTeamCheckIn, updateTeamSeed, updateTeamStatus } from './actions/teams'
import sharedStyles from './admin.module.css'
import styles from './table.module.css'

const STATUS_LABEL: Record<TeamStatus, string> = {
  pending: '待审核',
  approved: '已通过',
  rejected: '已拒绝',
}

const STATUS_TONE = { pending: 't', approved: 'ct', rejected: 'alert' } as const

export function TeamTable({ teams, tournamentId }: { teams: Team[]; tournamentId: number }) {
  const router = useRouter()
  const [pending, startTransition] = useTransition()
  const [keyword, setKeyword] = useState('')
  const [message, setMessage] = useState('')
  const approvedCount = teams.filter(team => team.status === 'approved').length

  function mutate(work: () => Promise<{ ok: boolean; error?: string }>) {
    startTransition(async () => {
      try {
        const result = await work()
        setMessage(result.ok ? '' : (result.error ?? '操作失败，请重试'))
        router.refresh()
      } catch (error) {
        console.error('team mutation failed', error)
        setMessage('操作失败，请重试')
      }
    })
  }

  const rows = teams.filter(team =>
    keyword
      ? [team.name, team.tag, team.captain, team.dept ?? '']
          .join(' ')
          .toLowerCase()
          .includes(keyword.toLowerCase())
      : true,
  )

  if (teams.length === 0) return <Empty>还没有战队报名</Empty>

  return (
    <>
      <input
        className={styles.search}
        placeholder="搜索战队、TAG、队长、学院"
        aria-label="搜索报名战队"
        value={keyword}
        onChange={event => setKeyword(event.target.value)}
      />
      {message ? (
        <p className={sharedStyles.error} role="alert">
          {message}
        </p>
      ) : null}
      <p className={styles.scrollHint} id="team-table-hint">
        横向滑动查看完整报名资料
      </p>
      <div
        className={styles.tableWrap}
        role="region"
        aria-label="报名战队资料表"
        aria-describedby="team-table-hint"
        tabIndex={0}
      >
        <table className={styles.table}>
          <thead>
            <tr>
              <th>种子</th>
              <th>状态</th>
              <th>签到</th>
              <th>TAG</th>
              <th>战队</th>
              <th>队长</th>
              <th>联系方式</th>
              <th>学院</th>
              <th>队员</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {rows.map(team => (
              <tr key={team.id}>
                <td>
                  <input
                    key={`${team.id}:${team.seed ?? 'none'}`}
                    className={styles.seedInput}
                    type="number"
                    min={1}
                    max={approvedCount}
                    defaultValue={team.seed ?? ''}
                    placeholder="—"
                    aria-label={`${team.name} 的种子号`}
                    disabled={pending || team.status !== 'approved'}
                    onBlur={event => {
                      const raw = event.currentTarget.value.trim()
                      const seed = raw === '' ? null : Number(raw)
                      if (seed === team.seed) return
                      mutate(() => updateTeamSeed(team.id, seed, tournamentId))
                    }}
                  />
                </td>
                <td>
                  <select
                    className={styles.select}
                    value={team.status}
                    aria-label={`${team.name} 的审核状态`}
                    disabled={pending}
                    onChange={event => {
                      const status = event.target.value as TeamStatus
                      mutate(() => updateTeamStatus(team.id, status, tournamentId))
                    }}
                  >
                    {(Object.keys(STATUS_LABEL) as TeamStatus[]).map(status => (
                      <option key={status} value={status}>
                        {STATUS_LABEL[status]}
                      </option>
                    ))}
                  </select>
                </td>
                <td>
                  <Button
                    variant={team.checkedInAt ? 'ghost' : 'primary'}
                    size="mini"
                    disabled={pending || team.status !== 'approved'}
                    title={team.checkedInAt ?? undefined}
                    aria-pressed={Boolean(team.checkedInAt)}
                    aria-label={`${team.name}${team.checkedInAt ? '取消签到' : '签到'}`}
                    onClick={() => {
                      if (
                        team.checkedInAt &&
                        !confirm(`确定取消「${team.name}」的签到？原签到时间将被清除。`)
                      ) {
                        return
                      }
                      mutate(() =>
                        updateTeamCheckIn(
                          team.id,
                          !team.checkedInAt,
                          team.checkedInAt,
                          tournamentId,
                        ),
                      )
                    }}
                  >
                    {team.checkedInAt ? '取消签到' : '签到'}
                  </Button>
                </td>
                <td>
                  <Badge tone={STATUS_TONE[team.status]}>{team.tag}</Badge>
                </td>
                <td>{team.name}</td>
                <td>{team.captain}</td>
                <td className={styles.sensitive}>{team.contact}</td>
                <td>{team.dept ?? '—'}</td>
                <td className={styles.roster}>
                  {team.players.map(player => player.nickname).join('、') || '—'}
                </td>
                <td>
                  <Button
                    variant="danger"
                    size="mini"
                    disabled={pending}
                    aria-label={`删除 ${team.name}`}
                    onClick={() => {
                      if (!confirm(`确定删除「${team.name}」？此操作不可撤销。`)) return
                      mutate(() => deleteTeam(team.id, tournamentId))
                    }}
                  >
                    删除
                  </Button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </>
  )
}
