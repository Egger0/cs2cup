'use client'

import { type ReactNode, useActionState } from 'react'
import { Button } from '@/components/ui'
import { createTournament, type TournamentCreateState } from '../actions/tournaments'
import styles from '../admin.module.css'

const INITIAL_STATE: TournamentCreateState = { error: null }

export function TournamentCreateForm({ children }: { children: ReactNode }) {
  const [state, formAction, pending] = useActionState(createTournament, INITIAL_STATE)

  return (
    <form className={styles.editor} action={formAction}>
      {children}
      <div className={styles.rowActions}>
        <Button type="submit" variant="primary" disabled={pending}>
          {pending ? '创建中…' : '创建为草稿'}
        </Button>
        {state.error ? (
          <span className={styles.error} role="alert">
            {state.error}
          </span>
        ) : null}
      </div>
    </form>
  )
}
