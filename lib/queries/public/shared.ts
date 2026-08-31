import 'server-only'
import { selectPublicRow } from '../../rdb'
import type { SiteSetting } from '../../types'

const SITE_SETTING_SELECT =
  'id,club_name,club_name_en,school,logo_url,contact_qq,contact_wechat,footer_copy'

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

export async function safely<T>(work: () => Promise<T>, fallback: T): Promise<T> {
  try {
    return await work()
  } catch (error) {
    if (
      process.env.NEXT_PHASE === 'phase-production-build' ||
      process.env.HOME_PREVIEW_COUNTDOWN === '1'
    ) {
      return fallback
    }
    throw error
  }
}

export async function getSiteSetting(): Promise<SiteSetting | null> {
  const row = await selectPublicRow<SiteSettingRow>('site_setting', {
    select: SITE_SETTING_SELECT,
  })
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
