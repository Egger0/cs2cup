'use server'

import { updateTag } from 'next/cache'
import { requireAdmin } from '@/lib/auth'
import { cloudflareEnvironment } from '@/lib/cloudflare-bindings'
import { qqBotConfig, syncQqGroupCommandPanel } from '@/lib/qq-bot'
import { adminSaveSiteSetting } from '@/lib/queries/content'

export async function updateSiteSetting(form: FormData) {
  await requireAdmin()
  await adminSaveSiteSetting({
    club_name: String(form.get('clubName') ?? '').trim(),
    club_name_en: String(form.get('clubNameEn') ?? '').trim() || null,
    school: String(form.get('school') ?? '').trim(),
    contact_qq: String(form.get('contactQq') ?? '').trim() || null,
    contact_wechat: String(form.get('contactWechat') ?? '').trim() || null,
    footer_copy: String(form.get('footerCopy') ?? '').trim() || null,
  })
  updateTag('site_setting')
}

export async function syncQqCommandPanel() {
  await requireAdmin()
  const config = qqBotConfig(cloudflareEnvironment())
  if (!config?.allowedGroupOpenId) throw new Error('QQ robot is not configured')
  await syncQqGroupCommandPanel(config)
}
