import type { Metadata } from 'next'
import { notFound, redirect } from 'next/navigation'
import { ButtonLink, Empty } from '@/components/ui'
import { SectionHead } from '@/components/domain/Sections'
import { getRegistrationStatus, getTournament, safely } from '@/lib/queries/public'
import { cloudflareBindings } from '@/lib/cloudflare-bindings'
import { getAuthContext } from '@/lib/identity/kernel'
import { getMembershipState } from '@/lib/identity/membership-service'
import { getRegistrationDraft } from '@/lib/identity/registration-workflow'
import { RegisterForm } from './RegisterForm'
import { registrationAccountHref, registrationAuthHref } from '@/lib/registration-navigation'

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
  const [membership, draft] =
    context.kind === 'authenticated'
      ? await Promise.all([
          getMembershipState(database, context),
          getRegistrationDraft(database, context, slug),
        ])
      : [null, null]
  const eligible = membership?.ok === true && membership.membership?.status === 'approved'

  return (
    <section className="section">
      <div className="wrap">
        <div data-rise>
          <SectionHead
            eyebrow={accepting ? `还剩 ${seatsLeft} / ${status.cap} 个席位` : '报名已截止'}
            title="组队报名"
            lede={
              accepting ? '提交后由主办方审核。通过的战队会出现在参赛名单并进入对阵表。' : undefined
            }
          />
        </div>

        {accepting && context.kind === 'anonymous' ? (
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
            赛事报名归属于账号。创建账号后可申请成员资格；等待期间仍可登录和维护资料。
          </Empty>
        ) : accepting ? (
          <>
            {!eligible ? (
              <Empty
                action={
                  <ButtonLink
                    href={`${registrationAccountHref(slug)}#membership`}
                    variant="primary"
                  >
                    查看或提交资格申请
                  </ButtonLink>
                }
              >
                你可以先填写并保存草稿；通过成员资格审核后，再完成最终提交。
              </Empty>
            ) : null}
            <div data-rise="2">
              <RegisterForm slug={slug} canSubmit={eligible} initialValues={draft?.values} />
            </div>
          </>
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
    </section>
  )
}
