'use client'

import { useRouter } from 'next/navigation'
import { useCallback, useEffect, useRef, useState, useTransition } from 'react'
import { flushSync } from 'react-dom'
import { updateTeamCheckIn } from '@/app/admin/(console)/actions/teams'
import { Badge, Button, Empty, Field } from '@/components/ui'
import { formatSiteTime } from '@/lib/datetime'
import type { TournamentCheckInTeam } from '@/lib/queries/staff-check-in'
import styles from './CheckInDesk.module.css'

const AUTO_REFRESH_MS = 15_000

export function CheckInDesk({
  authorizationRecoveryPath,
  initialTeams,
  tournamentId,
}: {
  authorizationRecoveryPath: string
  initialTeams: TournamentCheckInTeam[]
  tournamentId: number
}) {
  const router = useRouter()
  const [teams, setTeams] = useState(initialTeams)
  const [refreshPending, startRefresh] = useTransition()
  const [keyword, setKeyword] = useState('')
  const [busyId, setBusyId] = useState<number | null>(null)
  const [message, setMessage] = useState<{ tone: 'ok' | 'error'; text: string } | null>(null)
  const [closed, setClosed] = useState(false)
  const writeInFlight = useRef(false)
  const refreshInFlight = useRef(false)
  const query = keyword.trim().toLocaleLowerCase('zh-CN')
  const visibleTeams = teams.filter(team =>
    query
      ? [team.tag, team.name, team.captain, team.dept ?? '']
          .join(' ')
          .toLocaleLowerCase('zh-CN')
          .includes(query)
      : true,
  )
  const checkedInCount = teams.filter(team => team.checkedInAt).length

  useEffect(() => {
    // The latest server projection wins after another operator changes the roster or check-in state.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setTeams(initialTeams)
  }, [initialTeams])

  useEffect(() => {
    refreshInFlight.current = refreshPending
  }, [refreshPending])

  const beginServerRefresh = useCallback(() => {
    if (refreshInFlight.current) return
    refreshInFlight.current = true
    startRefresh(() => router.refresh())
  }, [router])

  const refreshFromServer = useCallback(() => {
    if (writeInFlight.current) return
    beginServerRefresh()
  }, [beginServerRefresh])

  useEffect(() => {
    const refreshVisibleDesk = () => {
      if (document.visibilityState === 'visible') refreshFromServer()
    }
    const interval = window.setInterval(refreshVisibleDesk, AUTO_REFRESH_MS)
    window.addEventListener('focus', refreshVisibleDesk)
    document.addEventListener('visibilitychange', refreshVisibleDesk)
    return () => {
      window.clearInterval(interval)
      window.removeEventListener('focus', refreshVisibleDesk)
      document.removeEventListener('visibilitychange', refreshVisibleDesk)
    }
  }, [refreshFromServer])

  function clearSearch() {
    document.getElementById('team-check-in-search')?.focus()
    setKeyword('')
  }

  async function toggleCheckIn(team: TournamentCheckInTeam) {
    if (busyId !== null || writeInFlight.current || refreshInFlight.current) return
    if (team.checkedInAt && !confirm(`确认取消「${team.tag}」的签到记录？`)) return

    writeInFlight.current = true
    setBusyId(team.id)
    setMessage(null)
    try {
      const result = await updateTeamCheckIn(
        team.id,
        !team.checkedInAt,
        team.checkedInAt,
        tournamentId,
      )
      if (!result.ok) {
        if (result.code === 'forbidden') {
          flushSync(() => setClosed(true))
          window.location.replace(authorizationRecoveryPath)
          return
        }
        setMessage({ tone: 'error', text: result.error })
        if (result.code === 'conflict') beginServerRefresh()
        return
      }
      setTeams(current =>
        current.map(item =>
          item.id === team.id ? { ...item, checkedInAt: result.checkedInAt } : item,
        ),
      )
      setMessage({
        tone: 'ok',
        text: `${team.tag} ${result.checkedInAt ? '已完成签到' : '已取消签到'}`,
      })
      beginServerRefresh()
    } catch (error) {
      console.error('check-in mutation failed', error)
      setMessage({ tone: 'error', text: '签到服务暂时不可用，请稍后重试。' })
    } finally {
      writeInFlight.current = false
      setBusyId(null)
    }
  }

  if (closed) {
    return (
      <section className={styles.closed} role="alert">
        <p>ACCESS / CLOSED</p>
        <h2>工作权限已变更</h2>
        <span>当前名单已从页面移除，正在重新核验访问权限。</span>
      </section>
    )
  }

  return (
    <section
      className={styles.desk}
      aria-labelledby="desk-summary"
      aria-busy={refreshPending || busyId !== null || undefined}
    >
      <div className={styles.summary}>
        <div>
          <p id="desk-summary">CHECK-IN STATUS</p>
          <strong>
            <span>{checkedInCount}</span> / {teams.length}
          </strong>
          <small>支战队已签到</small>
        </div>
        <div className={styles.progress} aria-hidden="true">
          <span
            style={
              {
                '--checked-in-ratio': teams.length ? checkedInCount / teams.length : 0,
              } as React.CSSProperties
            }
          />
        </div>
      </div>

      <div className={styles.tools}>
        <Field
          id="team-check-in-search"
          label="查找战队"
          type="search"
          autoComplete="off"
          placeholder="搜索 TAG、队名、队长或学院"
          value={keyword}
          onChange={event => setKeyword(event.target.value)}
        />
        <div className={styles.toolStatus}>
          <p aria-hidden="true">
            SHOWING {visibleTeams.length} / {teams.length} · AUTO SYNC 15S
          </p>
          <Button
            type="button"
            size="mini"
            disabled={busyId !== null || refreshPending}
            onClick={refreshFromServer}
          >
            {refreshPending ? '同步中…' : '刷新名单'}
          </Button>
        </div>
      </div>

      {message ? (
        <p
          className={message.tone === 'ok' ? styles.success : styles.error}
          role={message.tone === 'ok' ? 'status' : 'alert'}
          aria-live={message.tone === 'ok' ? 'polite' : 'assertive'}
        >
          {message.text}
        </p>
      ) : null}

      {teams.length === 0 ? (
        <Empty>当前没有可签到的战队。名单只会显示审核通过的报名。</Empty>
      ) : visibleTeams.length === 0 ? (
        <div role="status" aria-live="polite">
          <Empty
            action={
              <Button type="button" onClick={clearSearch}>
                清除搜索
              </Button>
            }
          >
            没有找到匹配的战队。
          </Empty>
        </div>
      ) : (
        <ul className={styles.list} aria-label="可签到战队">
          {visibleTeams.map(team => {
            const isBusy = busyId === team.id
            const time = team.checkedInAt ? formatSiteTime(team.checkedInAt) : null
            return (
              <li key={team.id} className={styles.team} aria-busy={isBusy || undefined}>
                <div className={styles.teamLead}>
                  <Badge tone={team.checkedInAt ? 'ct' : 'neutral'}>{team.tag}</Badge>
                  <p className={team.checkedInAt ? styles.checked : styles.waiting}>
                    {team.checkedInAt ? `已签到${time ? ` · ${time}` : ''}` : '等待签到'}
                  </p>
                </div>
                <h2>{team.name}</h2>
                <dl className={styles.details}>
                  <div>
                    <dt>队长</dt>
                    <dd>{team.captain}</dd>
                  </div>
                  <div>
                    <dt>学院</dt>
                    <dd>{team.dept ?? '未填写'}</dd>
                  </div>
                </dl>
                <Button
                  type="button"
                  variant={team.checkedInAt ? 'ghost' : 'primary'}
                  disabled={busyId !== null || refreshPending}
                  aria-label={`${team.tag} ${team.name} ${team.checkedInAt ? '取消签到' : '确认签到'}`}
                  onClick={() => void toggleCheckIn(team)}
                >
                  {isBusy ? '正在记录…' : team.checkedInAt ? '取消签到' : '确认签到'}
                </Button>
              </li>
            )
          })}
        </ul>
      )}
    </section>
  )
}
