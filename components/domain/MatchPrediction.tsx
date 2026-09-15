'use client'

import Link from 'next/link'
import { useEffect, useId, useState, type FormEvent } from 'react'
import type { MatchPredictionBoard } from '@/lib/match-prediction'
import { formatSiteDateTime } from '@/lib/datetime'
import styles from './MatchPrediction.module.css'

const PRESETS = [10, 50, 100]
const STATUS_COPY = { open: '待开奖', won: '猜中', lost: '未猜中', void: '已退回' } as const

type Payload = { ok: boolean; error?: string; board?: MatchPredictionBoard }

function ratio(total: number, side: number) {
  return side > 0 ? `×${(total / side).toFixed(2)}` : '—'
}

export function MatchPrediction({ matchId }: { matchId: number }) {
  const heading = useId()
  const [board, setBoard] = useState<MatchPredictionBoard | null>(null)
  const [teamId, setTeamId] = useState<number | null>(null)
  const [stake, setStake] = useState(10)
  const [working, setWorking] = useState(false)
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(null)
  const endpoint = `/api/matches/${matchId}/prediction`

  useEffect(() => {
    let active = true
    fetch(endpoint, { credentials: 'same-origin', headers: { Accept: 'application/json' } })
      .then(response => response.json() as Promise<Payload>)
      .then(payload => {
        if (active && payload.board) setBoard(payload.board)
      })
      .catch(() => undefined)
    return () => {
      active = false
    }
  }, [endpoint])

  if (!board?.sides || board.phase === 'unavailable') return null
  const [a, b] = board.sides
  const total = a.stake + b.stake
  const share = total ? (a.stake / total) * 100 : 50
  const mineSide = board.sides.find(side => side.id === board.mine?.teamId)
  const canPlace = board.phase === 'open' && board.viewer === 'member' && !board.mine

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (working || teamId === null) return
    setWorking(true)
    setMessage(null)
    try {
      const response = await fetch(endpoint, {
        method: 'POST',
        credentials: 'same-origin',
        headers: {
          Accept: 'application/json',
          'Content-Type': 'application/x-www-form-urlencoded',
        },
        body: new URLSearchParams({ teamId: String(teamId), stake: String(stake) }),
      })
      const payload = (await response.json()) as Payload
      if (payload.board) setBoard(payload.board)
      setMessage(
        payload.ok
          ? { ok: true, text: '投入成功，结果揭晓后自动结算。' }
          : { ok: false, text: payload.error ?? '竞猜暂时不可用，请稍后重试。' },
      )
    } catch {
      setMessage({ ok: false, text: '网络异常，请稍后重试。' })
    } finally {
      setWorking(false)
    }
  }

  return (
    <section className={styles.panel} aria-labelledby={heading} aria-busy={working}>
      <header className={styles.head}>
        <span className={styles.eyebrow}>PICK&apos;EM / 赛前竞猜</span>
        <h2 id={heading}>你看好谁？</h2>
        <p>
          {board.phase === 'open'
            ? `开赛前截止${board.closesAt ? ` · ${formatSiteDateTime(board.closesAt)}` : ''}`
            : board.phase === 'settled'
              ? '已开奖'
              : '竞猜已截止'}
          {` · 奖池 ${total} nbt · ${a.backers + b.backers} 人参与`}
        </p>
      </header>

      <div className={styles.pool}>
        {board.sides.map((side, index) => (
          <div
            key={side.id}
            className={`${styles.side} ${index ? styles.sideB : styles.sideA}`}
            data-winner={board.winnerTeamId === side.id || undefined}
          >
            <strong>{side.tag}</strong>
            <span className={styles.sideName}>{side.name}</span>
            <span className={styles.figures}>
              <b>{ratio(total, side.stake)}</b> {side.stake} nbt · {side.backers} 人
            </span>
          </div>
        ))}
        <div className={styles.bar} aria-hidden="true">
          <span style={{ inlineSize: `${share}%` }} />
        </div>
      </div>

      {board.mine && mineSide ? (
        <p className={styles.receipt} data-status={board.mine.status}>
          <span>{STATUS_COPY[board.mine.status]}</span>
          你投入 {board.mine.stake} nbt 支持 {mineSide.tag}
          {board.mine.status === 'open'
            ? `，猜中预计返还 ${Math.floor((board.mine.stake * total) / mineSide.stake)} nbt`
            : board.mine.status === 'void'
              ? '，已全额退回'
              : `，结算 ${board.mine.delta > 0 ? '+' : ''}${board.mine.delta} nbt`}
        </p>
      ) : canPlace ? (
        <form className={styles.form} onSubmit={submit}>
          <fieldset className={styles.pick}>
            <legend>选择支持的战队</legend>
            {board.sides.map(side => (
              <label key={side.id}>
                <input
                  type="radio"
                  name="teamId"
                  value={side.id}
                  checked={teamId === side.id}
                  onChange={() => setTeamId(side.id)}
                  required
                />
                <span>支持 {side.tag}</span>
              </label>
            ))}
          </fieldset>
          <div className={styles.stake}>
            <label>
              <span>投入 nbt</span>
              <input
                type="number"
                inputMode="numeric"
                min={1}
                max={Math.max(1, Math.min(1000, board.balance))}
                value={stake}
                onChange={event => setStake(Math.trunc(Number(event.target.value)))}
                required
              />
            </label>
            {[...PRESETS, Math.min(1000, board.balance)].map((value, index) => (
              <button
                key={index}
                type="button"
                className={styles.preset}
                aria-pressed={stake === value}
                disabled={value < 1 || value > board.balance}
                onClick={() => setStake(value)}
              >
                {index === PRESETS.length ? '全部' : value}
              </button>
            ))}
          </div>
          <button className={styles.submit} type="submit" disabled={working || board.balance < 1}>
            {working ? '正在投入…' : `投入 ${stake || 0} nbt`}
          </button>
          <small className={styles.balance}>
            余额 {board.balance} nbt
            {board.balance < 1 ? <Link href="/me#nbt-wallet">去签到领取 →</Link> : null}
          </small>
        </form>
      ) : board.phase === 'open' ? (
        <p className={styles.gate}>
          {board.viewer === 'anonymous' ? (
            <>
              <Link href="/login">登录</Link>后参与竞猜。
            </>
          ) : (
            <>
              <Link href="/account#membership">成员资格</Link>审核通过后可参与竞猜。
            </>
          )}
        </p>
      ) : null}

      {message ? (
        <p
          className={message.ok ? styles.success : styles.error}
          role={message.ok ? 'status' : 'alert'}
        >
          {message.text}
        </p>
      ) : null}
      <p className={styles.note}>nbt 是社团站内积分，只用于竞猜娱乐，不能充值、兑换或提现。</p>
    </section>
  )
}
