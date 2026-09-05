import { sendQqMorning, type QqAutomationDatabase } from './lib/qq-automation'
import type { QqBotApiConfig } from './lib/qq-bot-api'

interface NextWorker {
  fetch(request: Request, env: unknown, ctx: unknown): Promise<Response>
}

interface WorkerExecutionContext {
  waitUntil(promise: Promise<unknown>): void
}

interface WorkerEnvironment {
  CS2CUP_DB?: QqAutomationDatabase
  QQ_BOT_APP_ID?: string
  QQ_BOT_APP_SECRET?: string
  QQ_BOT_ALLOWED_GROUP_OPEN_ID?: string
}

// OpenNext creates this module during `npm run cf:build`.
// @ts-expect-error Generated OpenNext worker has no source declaration.
import generatedWorker from './.open-next/worker.js'

const nextWorker = generatedWorker as NextWorker

function botConfig(environment: WorkerEnvironment): QqBotApiConfig | null {
  const appId = environment.QQ_BOT_APP_ID?.trim()
  const appSecret = environment.QQ_BOT_APP_SECRET?.trim()
  return appId && appSecret ? { appId, appSecret } : null
}

const worker = {
  fetch(request: Request, environment: WorkerEnvironment, context: WorkerExecutionContext) {
    return nextWorker.fetch(request, environment, context)
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
