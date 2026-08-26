'use client'

import { useState, useTransition } from 'react'
import { Button } from '@/components/ui'
import { buildBracket } from '../../_actions'
import styles from '../../admin.module.css'

export function BracketBuilder({
  tournamentId,
  teamCap,
  approvedCount,
  existingMatches,
}: {
  tournamentId: number
  teamCap: number
  approvedCount: number
  existingMatches: number
}) {
  const [pending, startTransition] = useTransition()
  const [message, setMessage] = useState('')

  return (
    <div>
      <p style={{ color: 'var(--muted)', marginBottom: 18 }}>
        按种子号生成单败淘汰对阵:1 号对最后一号,2 号对倒数第二,以此类推。
        {existingMatches > 0 ? '重新生成会清空现有对阵、比分和 Ban/Pick 记录。' : ''}
      </p>
      <div className={styles.rowActions}>
        <Button
          variant={existingMatches > 0 ? 'danger' : 'primary'}
          disabled={pending}
          onClick={() => {
            const warning =
              existingMatches > 0
                ? `重新抽签会删除 ${existingMatches} 场比赛,连同比分与 Ban/Pick 记录,确定?`
                : `按 ${approvedCount} 支通过审核的战队生成对阵表?`
            if (!confirm(warning)) return
            startTransition(async () => {
              const result = await buildBracket(tournamentId, teamCap)
              setMessage(result.ok ? `已生成 ${result.created} 场比赛` : (result.error ?? '失败'))
            })
          }}
        >
          {pending ? '生成中…' : existingMatches > 0 ? '重新抽签' : '生成对阵表'}
        </Button>
        {message ? <span className={styles.ok}>{message}</span> : null}
      </div>
    </div>
  )
}
