interface ScoreWriteResult {
  ok: boolean
  error?: string
  code?: string
  confirmationToken?: string
}

function requiresConfirmation(result: ScoreWriteResult) {
  return (
    !result.ok &&
    result.code === 'score_correction_confirmation' &&
    typeof result.error === 'string' &&
    typeof result.confirmationToken === 'string'
  )
}

export async function confirmScoreWrite<Result extends ScoreWriteResult>(
  write: (confirmationToken: string | null) => Promise<Result>,
  confirm: (message: string) => boolean,
): Promise<Result | null> {
  let confirmationToken: string | null = null
  while (true) {
    const result = await write(confirmationToken)
    if (!requiresConfirmation(result)) return result
    if (!confirm(result.error ?? '')) return null
    confirmationToken = result.confirmationToken ?? null
  }
}
