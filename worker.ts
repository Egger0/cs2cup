import nextWorker from './.open-next/worker.js'
import { sendQqMorning, type QqAutomationDatabase } from './lib/qq-automation'
import type { QqBotApiConfig } from './lib/qq-bot-api'
import { httpsRedirect } from './lib/site-config'

interface WorkerExecutionContext {
  waitUntil(promise: Promise<unknown>): void
}

interface WorkerEnvironment {
  NEXT_PUBLIC_SITE_URL?: string
  CS2CUP_DB?: QqAutomationDatabase
  QQ_BOT_APP_ID?: string
  QQ_BOT_APP_SECRET?: string
  QQ_BOT_ALLOWED_GROUP_OPEN_ID?: string
}

function botConfig(environment: WorkerEnvironment): QqBotApiConfig | null {
  const appId = environment.QQ_BOT_APP_ID?.trim()
  const appSecret = environment.QQ_BOT_APP_SECRET?.trim()
  return appId && appSecret ? { appId, appSecret } : null
}

const worker = {
  fetch(request: Request, environment: WorkerEnvironment, context: WorkerExecutionContext) {
    return (
      httpsRedirect(request, environment.NEXT_PUBLIC_SITE_URL) ??
      nextWorker.fetch(request, environment, context)
    )
  },

  async scheduled(controller: { scheduledTime: number }, environment: WorkerEnvironment) {
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
