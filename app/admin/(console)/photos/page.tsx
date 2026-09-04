import { Empty } from '@/components/ui'
import { AdminPageHeader } from '@/components/admin/AdminPageHeader'
import { requireAdmin } from '@/lib/auth'
import { adminListPhotos, adminListTournaments } from '@/lib/queries/content'
import { PhotoRow } from './PhotoRow'
import { Uploader } from './Uploader'
import styles from '../admin.module.css'

export const dynamic = 'force-dynamic'

export default async function AdminPhotosPage() {
  await requireAdmin()

  const [photos, tournaments] = await Promise.all([adminListPhotos(), adminListTournaments()])
  const label = (id: number) => {
    const found = tournaments.find(entry => entry.id === id)
    return found ? `${found.season} · ${found.title}` : '未知赛事'
  }

  return (
    <>
      <AdminPageHeader
        index="06"
        title="素材库"
        description="上传赛事影像，并核对素材归属与文件信息。"
      />
      <section className={styles.panel}>
        <h2 className={styles.panelHead}>上传素材</h2>
        {tournaments.length === 0 ? (
          <Empty>先创建一届赛事,图片需要归属</Empty>
        ) : (
          <Uploader tournaments={tournaments} />
        )}
      </section>

      <section className={styles.panel}>
        <h2 className={styles.panelHead}>已有素材 · {photos.length} 张</h2>
        {photos.length === 0 ? (
          <Empty>还没有上传任何图片</Empty>
        ) : (
          <div className={styles.list}>
            {photos.map(photo => (
              <PhotoRow key={photo.id} photo={photo} tournamentLabel={label(photo.tournamentId)} />
            ))}
          </div>
        )}
      </section>
    </>
  )
}
