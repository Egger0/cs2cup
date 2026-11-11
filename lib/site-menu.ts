import { accountHeaderLinks, type AccountAccess } from './account-navigation'
import { cloudflareBindings } from './cloudflare-bindings'
import { currentTimeMillis } from './current-time'
import { recruitmentLotteryState } from './recruitment-lottery'
import { LOTTERY_LINK, PUBLIC_LINKS } from './site-navigation'

export async function siteMenuLinks(access: AccountAccess | null) {
  const lottery = await recruitmentLotteryState(cloudflareBindings().db, null, currentTimeMillis())
    .then(state => state.phase === 'open')
    .catch(() => false)
  return [...PUBLIC_LINKS, ...(lottery ? [LOTTERY_LINK] : []), ...accountHeaderLinks(access)]
}
