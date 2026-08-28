import {
  callPublicFunction,
  selectPrivateRows,
  selectPublicRows,
} from '../lib/rdb'

function compileTimeCacheContract() {
  selectPublicRows('game', {
    select: 'id,slug,name',
    cache: { mode: 'revalidate', seconds: 300 },
  })
  selectPublicRows('team_public', { select: 'id,name,tag', cache: { mode: 'no-store' } })
  selectPrivateRows('admin_user')
  callPublicFunction('registration_status', { p_slug: 'test-cup' })

  // @ts-expect-error Public reads require an explicit cache policy.
  selectPublicRows('game', { select: 'id' })
  // @ts-expect-error Public reads require an explicit column projection.
  selectPublicRows('game', { cache: { mode: 'no-store' } })
  // @ts-expect-error Private relations cannot enter the public cache API.
  selectPublicRows('admin_user', { select: 'user_id', cache: { mode: 'no-store' } })
  selectPublicRows('game', {
    select: 'id',
    // @ts-expect-error Credential selection is internal to the public/private API split.
    credential: 'admin',
    cache: { mode: 'no-store' },
  })
  // @ts-expect-error Private reads never accept a persistent cache policy.
  selectPrivateRows('admin_user', { cache: { mode: 'revalidate', seconds: 300 } })
  // @ts-expect-error Privileged RPCs cannot enter the public function allowlist.
  callPublicFunction('submit_team_rate_limited', {})
}

void compileTimeCacheContract
