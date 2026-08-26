'use client'

import { useState, useTransition } from 'react'
import { Button } from '@/components/ui'
import { removeTournament } from '../_actions'
import styles from '../admin.module.css'

export function TournamentDeleteButton({ id, title }: { id: number; title: string }) {
  const [pending, startTransition] = useTransition()
  const [error, setError] = useState('')

  return (
    <>
      <Button
        size="mini"
        variant="danger"
        disabled={pending}
        onClick={() => {
          if (!confirm(`确定删除「${title}」?报名、对阵和图片也会一并删除。`)) return
          startTransition(async () => {
            setError('')
            const result = await removeTournament(id)
            if (!result.ok) setError(result.error)
          })
        }}
      >
        删除
      </Button>
      {error ? <span className={styles.error}>{error}</span> : null}
    </>
  )
}
