import type { Metadata } from 'next'
import { redirect } from 'next/navigation'
import { AccountShell } from '@/components/account/AccountShell'
import { PageMasthead } from '@/components/domain/Sections'
import { cloudflareBindings } from '@/lib/cloudflare-bindings'
import { currentTimeMillis } from '@/lib/current-time'
import { accountHasWorkAccess } from '@/lib/identity/account-security-state'
import { getAuthContext } from '@/lib/identity/kernel'
import { squadTournaments } from '@/lib/squad-registration'
import { accountSquads, incomingSquadInvitations, listSquadGames } from '@/lib/squads'
import { CreateSquadForm } from './CreateSquadForm'
import { SquadCard } from './SquadCard'
import { SquadInvitationInbox } from './SquadInvitationInbox'
import styles from './squads.module.css'

export const dynamic = 'force-dynamic'

export const metadata: Metadata = {
  title: '我的小队',
  robots: { index: false, follow: false, nocache: true },
  referrer: 'no-referrer',
}

export default async function SquadsPage() {
  const context = await getAuthContext()
  if (context.kind === 'anonymous') redirect('/login?redirectKey=account')
  if (context.session.recoveryRestricted) redirect('/account/security?recovery=1')
  const database = cloudflareBindings().db
  const accountId = context.account.id
  const [squads, invitations, games, workAccess] = await Promise.all([
    accountSquads(database, accountId),
    incomingSquadInvitations(database, accountId),
    listSquadGames(database),
    accountHasWorkAccess(database, accountId, currentTimeMillis()),
  ])
  const tournaments = await Promise.all(
    squads.map(squad => squadTournaments(database, { id: squad.id, gameId: squad.game.id })),
  )
  const openGames = games.filter(game => !squads.some(squad => squad.game.id === game.id))

  return (
    <AccountShell
      access={{ hasWorkAccess: workAccess, recoveryRestricted: false }}
      identity={context.account.displayName}
      masthead={
        <PageMasthead
          code="SQUADS"
          eyebrow="组队"
          title="我的小队"
          lede="邀请队友组成小队，满员后由队长一键报名赛事，队员的参赛记录会自动归到各自账号。"
          density="compact"
        />
      }
    >
      <SquadInvitationInbox items={invitations} />
      <div className={styles.cards}>
        {squads.map((squad, index) => (
          <SquadCard
            key={squad.id}
            squad={squad}
            viewerAccountId={accountId}
            tournaments={tournaments[index] ?? []}
          />
        ))}
      </div>
      {openGames.length ? <CreateSquadForm games={openGames} /> : null}
    </AccountShell>
  )
}
