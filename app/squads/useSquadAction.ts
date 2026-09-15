'use client'

import { useRouter } from 'next/navigation'
import { useState, useTransition } from 'react'
import type { SquadActionResult } from './actions'

export function useSquadAction() {
  const router = useRouter()
  const [pending, startTransition] = useTransition()
  const [feedback, setFeedback] = useState<{ ok: boolean; text: string } | null>(null)

  function run(work: () => Promise<SquadActionResult>, onSuccess?: () => void) {
    setFeedback(null)
    startTransition(async () => {
      const result = await work().catch(
        (): SquadActionResult => ({ ok: false, error: '网络异常，请稍后重试。' }),
      )
      setFeedback(
        result.ok
          ? result.message
            ? { ok: true, text: result.message }
            : null
          : { ok: false, text: result.error },
      )
      if (result.ok) {
        onSuccess?.()
        router.refresh()
      }
    })
  }

  return { pending, feedback, run }
}
