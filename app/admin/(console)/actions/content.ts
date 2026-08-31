'use server'

import { updateTag } from 'next/cache'
import { redirect } from 'next/navigation'
import { requireAdmin } from '@/lib/auth'
import {
  adminCreateGame,
  adminCreateMember,
  adminCreatePost,
  adminDeleteGame,
  adminDeleteMember,
  adminDeletePost,
  adminListTournaments,
  adminSaveGame,
  adminSaveMember,
  adminSavePost,
} from '@/lib/queries/content'

export async function createPost(form: FormData) {
  await requireAdmin()
  const gameId = String(form.get('gameId') ?? '')
  await adminCreatePost({
    slug: String(form.get('slug') ?? '').trim(),
    title: String(form.get('title') ?? '').trim(),
    summary: String(form.get('summary') ?? '').trim(),
    body: String(form.get('body') ?? '').trim(),
    gameId: gameId ? Number(gameId) : null,
    pinned: form.get('pinned') === 'on',
  })
  updateTag('post')
  redirect('/admin/posts')
}

export async function updatePost(id: number, form: FormData) {
  await requireAdmin()
  const gameId = String(form.get('gameId') ?? '')
  await adminSavePost(id, {
    title: String(form.get('title') ?? '').trim(),
    summary: String(form.get('summary') ?? '').trim(),
    body: String(form.get('body') ?? '').trim(),
    gameId: gameId ? Number(gameId) : null,
    pinned: form.get('pinned') === 'on',
  })
  updateTag('post')
}

export async function removePost(id: number) {
  await requireAdmin()
  await adminDeletePost(id)
  updateTag('post')
}

export async function updateGame(id: number, form: FormData) {
  await requireAdmin()
  await adminSaveGame(id, {
    name: String(form.get('name') ?? '').trim(),
    nameEn: String(form.get('nameEn') ?? '').trim() || null,
    accentColor: String(form.get('accentColor') ?? '').trim() || null,
    tagline: String(form.get('tagline') ?? '').trim() || null,
    description: String(form.get('description') ?? '').trim() || null,
    formatNote: String(form.get('formatNote') ?? '').trim() || null,
    active: form.get('active') === 'on',
  })
  updateTag('game')
}

export async function createGame(form: FormData) {
  await requireAdmin()
  await adminCreateGame({
    slug: String(form.get('slug') ?? '').trim(),
    name: String(form.get('name') ?? '').trim(),
    nameEn: String(form.get('nameEn') ?? '').trim() || null,
    accentColor: String(form.get('accentColor') ?? '').trim() || null,
    tagline: String(form.get('tagline') ?? '').trim() || null,
  })
  updateTag('game')
  redirect('/admin/games')
}

export async function removeGame(id: number) {
  await requireAdmin()

  const tournaments = await adminListTournaments()
  const linked = tournaments.filter(tournament => tournament.gameId === id)
  if (linked.length > 0) {
    return { ok: false as const, error: `该项目关联了 ${linked.length} 个赛事，请先处理这些赛事。` }
  }

  await adminDeleteGame(id)
  updateTag('game')
  updateTag('post')
  return { ok: true as const }
}

export async function updateMember(id: number, form: FormData) {
  await requireAdmin()
  await adminSaveMember(id, {
    name: String(form.get('name') ?? '').trim(),
    role: String(form.get('role') ?? '').trim(),
    handle: String(form.get('handle') ?? '').trim() || null,
    intro: String(form.get('intro') ?? '').trim() || null,
    sortOrder: Number(form.get('sortOrder')) || 0,
  })
  updateTag('club_member')
}

export async function createMember(form: FormData) {
  await requireAdmin()
  await adminCreateMember({
    name: String(form.get('name') ?? '').trim(),
    role: String(form.get('role') ?? '').trim(),
    handle: String(form.get('handle') ?? '').trim() || null,
    intro: String(form.get('intro') ?? '').trim() || null,
    sortOrder: Number(form.get('sortOrder')) || 0,
  })
  updateTag('club_member')
  redirect('/admin/members')
}

export async function removeMember(id: number) {
  await requireAdmin()
  await adminDeleteMember(id)
  updateTag('club_member')
}
