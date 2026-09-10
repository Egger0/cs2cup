'use client'

import { useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { Button } from '@/components/ui'
import { drawRecruitmentLotteryAction } from './actions'

export function LotteryDrawButton() {
  const router = useRouter()
  const [pending, startTransition] = useTransition()
  const [error, setError] = useState<string | null>(null)

  return (
    <div>
      <Button
        type="button"
        variant="primary"
        disabled={pending}
        onClick={() => {
          setError(null)
          startTransition(async () => {
            const result = await drawRecruitmentLotteryAction()
            if (!result.ok) {
              setError(result.error)
              return
            }
            router.refresh()
          })
        }}
      >
        {pending ? '抽取中…' : '抽取我的奖券'}
      </Button>
      {error ? <p role="alert">{error}</p> : null}
    </div>
  )
}
