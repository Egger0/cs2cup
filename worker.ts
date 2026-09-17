import nextWorker from './.open-next/worker.js'
import type { IdentityDatabase } from './lib/identity/internal/contracts'
import { syncOfficialLoadouts } from './lib/loadout-official-sync'
import { sendQqMorning, type QqAutomationDatabase } from './lib/qq-automation'
import type { QqBotApiConfig } from './lib/qq-bot-api'
import { httpsRedirect } from './lib/site-config'

interface WorkerExecutionContext {
  waitUntil(promise: Promise<unknown>): void
}

interface WorkerEnvironment {
  NEXT_PUBLIC_SITE_URL?: string
  CS2CUP_DB?: QqAutomationDatabase & IdentityDatabase
  QQ_BOT_APP_ID?: string
  QQ_BOT_APP_SECRET?: string
  QQ_BOT_ALLOWED_GROUP_OPEN_ID?: string
}

function botConfig(environment: WorkerEnvironment): QqBotApiConfig | null {
  const appId = environment.QQ_BOT_APP_ID?.trim()
  const appSecret = environment.QQ_BOT_APP_SECRET?.trim()
  return appId && appSecret ? { appId, appSecret } : null
}

const LOADOUT_SYNC_CRON = '30 19 * * *'

const worker = {
  fetch(request: Request, environment: WorkerEnvironment, context: WorkerExecutionContext) {
    return (
      httpsRedirect(request, environment.NEXT_PUBLIC_SITE_URL) ??
      nextWorker.fetch(request, environment, context)
    )
  },

  async scheduled(
    controller: { scheduledTime: number; cron: string },
    environment: WorkerEnvironment,
  ) {
    if (controller.cron === LOADOUT_SYNC_CRON) {
      if (!environment.CS2CUP_DB) return
      const result = await syncOfficialLoadouts(
        environment.CS2CUP_DB,
        fetch,
        controller.scheduledTime,
      )
      console.log('[loadouts] official sync', result)
      return
    }
    const config = botConfig(environment)
    const groupOpenId = environment.QQ_BOT_ALLOWED_GROUP_OPEN_ID?.trim()
    if (!config || !groupOpenId || !environment.CS2CUP_DB) {
      console.error('[qq-bot] morning message skipped: bot is not configured')
      return
    }
    await sendQqMorning(config, environment.CS2CUP_DB, groupOpenId, controller.scheduledTime)
  },
}

export default worker
