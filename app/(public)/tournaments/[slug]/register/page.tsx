import type { Metadata } from 'next'
import Link from 'next/link'
import { notFound, redirect } from 'next/navigation'
import { ButtonLink, Empty } from '@/components/ui'
import { SectionHead } from '@/components/domain/Sections'
import { getRegistrationStatus, getTournament, safely } from '@/lib/queries/public'
import { cloudflareBindings } from '@/lib/cloudflare-bindings'
import { getAuthContext } from '@/lib/identity/kernel'
import { getMembershipState } from '@/lib/identity/membership-service'
import { registrationAccountHref, registrationAuthHref } from '@/lib/registration-navigation'
import { squadTournaments } from '@/lib/squad-registration'
import { accountSquads, listSquadGames } from '@/lib/squads'
import { CreateSquadForm } from '@/app/squads/CreateSquadForm'
import { SquadCard } from '@/app/squads/SquadCard'
import styles from './register.module.css'

export const dynamic = 'force-dynamic'
export const metadata: Metadata = { title: '报名' }

export default async function RegisterPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params
  const tournament = await getTournament(slug)
  if (!tournament) notFound()

  const status = await safely(() => getRegistrationStatus(slug), {
    cap: tournament.teamCap,
    taken: 0,
    open: false,
  })
  const seatsLeft = Math.max(0, status.cap - status.taken)
  const accepting = status.open && seatsLeft > 0
  const context = await getAuthContext()
  if (context.kind === 'authenticated' && context.session.recoveryRestricted) {
    redirect('/account/security?recovery=1')
  }
  const database = cloudflareBindings().db
  const signedIn = context.kind === 'authenticated'
  const [membership, squads, games] = signedIn
    ? await Promise.all([
        getMembershipState(database, context),
        accountSquads(database, context.account.id),
        listSquadGames(database),
      ])
    : [null, [], []]
  const member = membership?.ok === true && membership.membership?.status === 'approved'
  const applying =
    membership?.ok === true &&
    !member &&
    ['pending', 'in_review'].includes(membership.application?.status ?? '')
  const squad = squads.find(candidate => candidate.game.id === tournament.gameId)
  const game = games.find(candidate => candidate.id === tournament.gameId)
  const entry = squad
    ? (await squadTournaments(database, { id: squad.id, gameId: squad.game.id })).filter(
        candidate => candidate.id === tournament.id,
      )
    : []

  return (
    <section className="section">
      <div className="wrap">
        <div className={styles.column}>
          <div data-rise>
            <SectionHead
              meta={accepting ? `还剩 ${seatsLeft} / ${status.cap} 个席位` : '报名已截止'}
              title="组队报名"
              lede={accepting ? '用你的战队提交报名，主办方审核通过后进入参赛名单。' : undefined}
            />
          </div>

          {accepting && !signedIn ? (
            <Empty
              action={
                <>
                  <ButtonLink
                    href={`/login?redirectKey=registration&tournamentSlug=${encodeURIComponent(slug)}`}
                    variant="primary"
                  >
                    登录后报名
                  </ButtonLink>
                  <ButtonLink href={registrationAuthHref('register', slug)}>创建账号</ButtonLink>
                </>
              }
            >
              报名需要一个账号，战队和报名记录都会保存在里面。
            </Empty>
          ) : accepting && signedIn ? (
            <div className={styles.flow} data-rise="2">
              {applying ? (
                <p className={styles.notice}>
                  你的成员资格还在审核中，可以直接提交报名，主办方会一并审核。
                </p>
              ) : !member ? (
                <p className={styles.notice}>
                  报名前请先提交成员资格申请，提交后就能报名，主办方会一并审核。
                  <Link href={`${registrationAccountHref(slug)}#membership`}>去申请</Link>
                </p>
              ) : null}
              {squad ? (
                <SquadCard squad={squad} viewerAccountId={context.account.id} tournaments={entry} />
              ) : game ? (
                <CreateSquadForm games={[game]} fixed />
              ) : null}
            </div>
          ) : (
            <Empty
              action={
                <>
                  <ButtonLink href={`/tournaments/${slug}/teams`} variant="primary">
                    看看谁报了名
                  </ButtonLink>
                  <ButtonLink href="/about">进群等下一届</ButtonLink>
                </>
              }
            >
              {status.open
                ? `${status.cap} 个席位已经报满了。下一届开放报名时会在社团动态里通知。`
                : '本届赛事不再接受报名。'}
            </Empty>
          )}
        </div>
      </div>
    </section>
  )
}
