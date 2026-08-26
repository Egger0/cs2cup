'use client'

import { useState, useTransition } from 'react'
import { Badge, Button, Empty } from '@/components/ui'
import type { Team, TeamStatus } from '@/lib/types'
import { deleteTeam, updateTeamStatus } from './_actions'
import styles from './admin.module.css'

const STATUS_LABEL: Record<TeamStatus, string> = {
  pending: '待审核',
  approved: '已通过',
  rejected: '已拒绝',
}

const STATUS_TONE = { pending: 't', approved: 'ct', rejected: 'alert' } as const

export function TeamTable({ teams, tournamentId }: { teams: Team[]; tournamentId: number }) {
  const [pending, startTransition] = useTransition()
  const [keyword, setKeyword] = useState('')

  const rows = teams.filter(team =>
    keyword
      ? [team.name, team.tag, team.captain, team.dept ?? ''].join(' ').toLowerCase().includes(keyword.toLowerCase())
      : true,
  )

  if (teams.length === 0) return <Empty>还没有战队报名</Empty>

  return (
    <>
      <input
        className={styles.search}
        placeholder="搜索战队、TAG、队长、学院"
        value={keyword}
        onChange={event => setKeyword(event.target.value)}
      />
      <div className={styles.tableWrap}>
        <table className={styles.table}>
          <thead>
            <tr>
              <th>种子</th>
              <th>状态</th>
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
                <td>{team.seed ? `#${team.seed}` : '—'}</td>
                <td>
                  <select
                    className={styles.select}
                    value={team.status}
                    disabled={pending}
                    onChange={event =>
                      startTransition(() =>
                        void updateTeamStatus(team.id, event.target.value as TeamStatus, tournamentId),
                      )
                    }
                  >
                    {(Object.keys(STATUS_LABEL) as TeamStatus[]).map(status => (
                      <option key={status} value={status}>
                        {STATUS_LABEL[status]}
                      </option>
                    ))}
                  </select>
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
                    onClick={() => {
                      if (!confirm(`确定删除「${team.name}」?此操作不可撤销。`)) return
                      startTransition(() => void deleteTeam(team.id, tournamentId))
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
