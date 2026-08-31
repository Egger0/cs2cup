import { notFound } from 'next/navigation'
import { PostList } from '@/components/domain/PostList'
import { SectionHead, StatRow } from '@/components/domain/Sections'
import {
  getPhotos,
  getSiteSetting,
  listMembers,
  listPosts,
  listTournaments,
  safely,
} from '@/lib/queries/public'
import styles from './page.module.css'

export const revalidate = 300

export const metadata = { title: '关于 · 宁波理工电竞社' }

export default async function ClubPage() {
  const [setting, members, posts, tournaments, photos] = await Promise.all([
    safely(getSiteSetting, null),
    safely(listMembers, []),
    safely(() => listPosts(), []),
    safely(listTournaments, []),
    safely(() => getPhotos(), []),
  ])

  if (!setting) notFound()

  const finished = tournaments.filter(tournament => tournament.status === 'finished')

  return (
    <>
      <section className="section">
        <div className="wrap">
          <div data-rise>
            <SectionHead eyebrow="关于我们" title={setting.clubName} />
          </div>

          <div data-rise="2">
            <div className={styles.intro}>
              <div>
                <p className={styles.paragraph}>
                  我们是{setting.school}
                  的学生电竞社团。日常做两件事:把校内比赛办起来,以及让想打比赛的人能找到队友。
                </p>
                <p className={styles.paragraph}>
                  宁理杯是社团每年的主赛事,到今年已经办到第 {tournaments.length} 届。除了 CS2,
                  社团也组织其他项目的内部赛和观赛活动。
                </p>
                <p className={styles.paragraph}>
                  一场比赛跑起来需要的远不止十个人——解说、OB 导播、现场摄影、海报设计、赛程编排,
                  每个位置都缺人。不打比赛也能加入。
                </p>
              </div>

              <div className={styles.facts}>
                <div className={styles.fact}>
                  <span className={styles.factKey}>学校</span>
                  <span className={styles.factValue}>{setting.school}</span>
                </div>
                <div className={styles.fact}>
                  <span className={styles.factKey}>主赛事</span>
                  <span className={styles.factValue}>宁理杯 · CS2</span>
                </div>
                <div className={styles.fact}>
                  <span className={styles.factKey}>已办届数</span>
                  <span className={styles.factValue}>{tournaments.length} 届</span>
                </div>
                <div className={styles.fact}>
                  <span className={styles.factKey}>现场存档</span>
                  <span className={styles.factValue}>{photos.length} 张照片</span>
                </div>
              </div>
            </div>
          </div>
        </div>
      </section>

      <div className="wrap">
        <StatRow
          items={[
            { value: String(tournaments.length), unit: '届', key: '举办赛事' },
            { value: String(finished.length), unit: '届', key: '已完赛' },
            { value: String(photos.length), unit: '张', key: '现场照片' },
            { value: String(members.length), unit: '人', key: '核心团队' },
          ]}
        />
      </div>

      {members.length > 0 ? (
        <section className="section">
          <div className="wrap">
            <div data-rise>
              <SectionHead
                eyebrow="核心团队"
                title="谁在把比赛跑起来"
                lede="名单待社团补充,岗位职责已经确定。"
              />
            </div>
            <div data-rise="2">
              <div className={styles.roles}>
                {members.map(member => (
                  <article key={member.id} className={styles.role}>
                    <div className={styles.roleName}>{member.role}</div>
                    <div className={styles.roleHolder}>{member.name}</div>
                    {member.intro ? <p className={styles.roleIntro}>{member.intro}</p> : null}
                  </article>
                ))}
              </div>
            </div>
          </div>
        </section>
      ) : null}

      <div className="divider" />

      <section className="section">
        <div className="wrap">
          <div data-rise>
            <SectionHead eyebrow="社团公告" title="最近发生了什么" />
          </div>
          <div data-rise="2">
            <PostList posts={posts} />
          </div>
        </div>
      </section>

      <section className="section" style={{ paddingTop: 0 }}>
        <div className="wrap">
          <div data-rise>
            <div className={styles.join}>
              <div className={styles.joinText}>
                <h2>想加入?直接来找我们</h2>
                <p>选手、解说、导播、摄影、设计、赛事运营——都缺人。先进群聊聊。</p>
              </div>
              <div className={styles.contacts}>
                {setting.contactQq ? (
                  <div className={styles.contact}>
                    <span>QQ 群</span>
                    {setting.contactQq}
                  </div>
                ) : null}
                {setting.contactWechat && setting.contactWechat !== '无' ? (
                  <div className={styles.contact}>
                    <span>微信</span>
                    {setting.contactWechat}
                  </div>
                ) : null}
              </div>
            </div>
          </div>
        </div>
      </section>
    </>
  )
}
