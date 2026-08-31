import 'server-only'

import { requireAdmin } from '../../auth'
import {
  deletePrivateRows,
  insertPrivateRows,
  selectPrivateRow,
  selectPrivateRows,
} from '../../rdb'
import { adminMutation } from './shared'

interface PhotoRow {
  id: number
  tournament_id: number
  storage_key: string
  width: number
  height: number
  blur_data_url: string | null
  caption: string | null
  sort_order: number
}

const toAdminPhoto = (row: PhotoRow) => ({
  id: row.id,
  tournamentId: row.tournament_id,
  storageKey: row.storage_key,
  width: row.width,
  height: row.height,
  caption: row.caption,
  sortOrder: row.sort_order,
})

export async function adminListPhotos(): Promise<
  {
    id: number
    tournamentId: number
    storageKey: string
    width: number
    height: number
    caption: string | null
    sortOrder: number
  }[]
> {
  await requireAdmin()

  const rows = await selectPrivateRows<PhotoRow>('photo', {
    order: 'tournament_id.desc,sort_order.asc',
  })
  return rows.map(toAdminPhoto)
}

export async function adminGetPhoto(id: number) {
  await requireAdmin()

  const row = await selectPrivateRow<PhotoRow>('photo', {
    filters: { id: `eq.${id}` },
  })
  return row ? toAdminPhoto(row) : null
}

export function adminInsertPhoto(values: {
  tournamentId: number
  storageKey: string
  width: number
  height: number
  caption: string | null
  sortOrder: number
}) {
  return adminMutation(() =>
    insertPrivateRows('photo', {
      tournament_id: values.tournamentId,
      storage_key: values.storageKey,
      width: values.width,
      height: values.height,
      caption: values.caption,
      sort_order: values.sortOrder,
    }),
  )
}

export function adminDeletePhoto(id: number) {
  return adminMutation(() => deletePrivateRows('photo', { filters: { id: `eq.${id}` } }))
}
