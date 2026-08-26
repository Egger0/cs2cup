import { Button, Field } from '@/components/ui'
import { adminListGames } from '@/lib/queries/content'
import { createGame } from '../_actions'
import { GameEditor } from './GameEditor'
import styles from '../admin.module.css'

export const dynamic = 'force-dynamic'

export default async function AdminGamesPage() {
  const games = await adminListGames()

  return (
    <>
      <section className={styles.panel}>
        <h2 className={styles.panelHead}>新增项目</h2>
        <form className={styles.editor} action={createGame}>
          <div className={styles.pair}>
            <Field id="ng-slug" name="slug" label="链接标识" required placeholder="例:apex" />
            <Field id="ng-name" name="name" label="中文名" required placeholder="例:Apex 英雄" />
          </div>
          <div className={styles.pair}>
            <Field id="ng-en" name="nameEn" label="英文名" placeholder="Apex Legends" />
            <Field id="ng-accent" name="accentColor" label="强调色" placeholder="#da292a" />
          </div>
          <Field id="ng-tagline" name="tagline" label="一句话介绍" />
          <Button type="submit" variant="primary">
            创建
          </Button>
        </form>
      </section>

      <section className={styles.panel}>
        <h2 className={styles.panelHead}>全部项目 · {games.length} 个</h2>
        <div className={styles.list}>
          {games.map(game => (
            <GameEditor key={game.id} game={game} />
          ))}
        </div>
      </section>
    </>
  )
}
