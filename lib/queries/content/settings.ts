import 'server-only'

import { requireAdmin } from '../../auth'
import { selectPrivateRows, updatePrivateRows } from '../../rdb'
import { adminMutation } from './shared'

interface SiteSettingRow {
  id: number
  club_name: string
  club_name_en: string | null
  school: string
  logo_url: string | null
  contact_qq: string | null
  contact_wechat: string | null
  footer_copy: string | null
}

export async function adminGetSiteSetting() {
  await requireAdmin()

  const rows = await selectPrivateRows<SiteSettingRow>('site_setting', { limit: 1 })
  const row = rows[0]
  if (!row) return null
  return {
    id: row.id,
    clubName: row.club_name,
    clubNameEn: row.club_name_en,
    school: row.school,
    logoUrl: row.logo_url,
    contactQq: row.contact_qq,
    contactWechat: row.contact_wechat,
    footerCopy: row.footer_copy,
  }
}

export function adminSaveSiteSetting(values: Record<string, unknown>) {
  return adminMutation(() => updatePrivateRows('site_setting', values, { filters: { id: 'eq.1' } }))
}
