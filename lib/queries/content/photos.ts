import 'server-only'

import { requireAdmin, requireTournamentStaffCapability } from '../../auth'
import {
  deletePrivateRows,
  insertPrivateRows,
  selectPrivateRow,
  selectPrivateRows,
  updatePrivateRows,
} from '../../rdb'

interface PhotoRow {
  id: number
  tournament_id: number
  storage_key: string
  width: number
  height: number
  blur_data_url: string | null
  caption: string | null
  sort_order: number
  variant_widths: string
}

function parseVariantWidths(value: string) {
  try {
    const parsed = JSON.parse(value)
    return Array.isArray(parsed) ? parsed.filter(entry => Number.isInteger(entry) && entry > 0) : []
  } catch {
    return []
  }
}

const toAdminPhoto = (row: PhotoRow) => ({
  id: row.id,
  tournamentId: row.tournament_id,
  storageKey: row.storage_key,
  width: row.width,
  height: row.height,
  caption: row.caption,
  sortOrder: row.sort_order,
  variantWidths: parseVariantWidths(row.variant_widths),
})

export async function adminListPhotos(tournamentIds?: readonly number[]): Promise<
  {
    id: number
    tournamentId: number
    storageKey: string
    width: number
    height: number
    caption: string | null
    sortOrder: number
    variantWidths: number[]
  }[]
> {
  if (tournamentIds === undefined) {
    await requireAdmin()
  } else {
    if (!tournamentIds.length) return []
    await Promise.all(
      tournamentIds.map(id => requireTournamentStaffCapability(id, 'tournament.media.manage')),
    )
  }

  const rows = await selectPrivateRows<PhotoRow>('photo', {
    filters: tournamentIds ? { tournament_id: `in.(${tournamentIds.join(',')})` } : undefined,
    order: 'tournament_id.desc,sort_order.asc',
  })
  return rows.map(toAdminPhoto)
}

export async function adminGetPhoto(id: number) {
  const row = await selectPrivateRow<PhotoRow>('photo', {
    filters: { id: `eq.${id}` },
  })
  if (row) await requireTournamentStaffCapability(row.tournament_id, 'tournament.media.manage')
  return row ? toAdminPhoto(row) : null
}

export async function adminInsertPhoto(values: {
  tournamentId: number
  storageKey: string
  width: number
  height: number
  caption: string | null
  sortOrder: number
  blurDataUrl: string | null
  variantWidths: number[]
}) {
  await requireTournamentStaffCapability(values.tournamentId, 'tournament.media.manage')
  return insertPrivateRows('photo', {
    tournament_id: values.tournamentId,
    storage_key: values.storageKey,
    width: values.width,
    height: values.height,
    caption: values.caption,
    sort_order: values.sortOrder,
    blur_data_url: values.blurDataUrl,
    variant_widths: JSON.stringify(values.variantWidths),
  })
}

export async function adminAttachPhotoVariants(values: {
  id: number
  blurDataUrl: string | null
  variantWidths: number[]
}) {
  const photo = await adminGetPhoto(values.id)
  if (!photo) throw new Error('照片不存在或已被删除')
  return updatePrivateRows(
    'photo',
    {
      blur_data_url: values.blurDataUrl,
      variant_widths: JSON.stringify(values.variantWidths),
    },
    { filters: { id: `eq.${values.id}`, tournament_id: `eq.${photo.tournamentId}` } },
  )
}

export async function adminDeletePhoto(id: number) {
  const photo = await adminGetPhoto(id)
  if (!photo) throw new Error('照片不存在或已被删除')
  return deletePrivateRows('photo', {
    filters: { id: `eq.${id}`, tournament_id: `eq.${photo.tournamentId}` },
  })
}
