import { LOADOUT_MODES, PRICE_TIERS, type LoadoutMode, type PriceTier } from '@/lib/delta-loadouts'
import { cloudflareBindings } from '@/lib/cloudflare-bindings'
import { randomLoadoutId, type LoadoutSource } from '@/lib/loadout-queries'
import { getAuthContext } from '@/lib/identity/kernel'
import { getGame } from '@/lib/queries/public'

export const dynamic = 'force-dynamic'

function pick<T extends string>(value: string | null, allowed: readonly T[]) {
  return allowed.includes(value as T) ? (value as T) : null
}

export async function GET(request: Request, { params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params
  const game = await getGame(slug).catch(() => null)
  const list = `/games/${encodeURIComponent(slug)}/loadouts`
  const redirect = (location: string) =>
    new Response(null, { status: 307, headers: { Location: location } })
  if (!game?.loadoutCodes) return redirect('/games')
  const search = new URL(request.url).searchParams
  const price = pick(search.get('price'), Object.keys(PRICE_TIERS) as PriceTier[])
  const weapon = search.get('weapon')?.slice(0, 30) || null
  const context = search.get('saved') === '1' ? await getAuthContext().catch(() => null) : null
  const savedBy = context?.kind === 'authenticated' ? context.account.id : null
  const id = await randomLoadoutId(cloudflareBindings().db, game.id, {
    mode: pick(search.get('mode'), Object.keys(LOADOUT_MODES) as LoadoutMode[]) ?? 'operations',
    source: pick(search.get('source'), ['member', 'official'] as LoadoutSource[]),
    weapons: weapon ? [weapon] : null,
    price: price ? [PRICE_TIERS[price][1], PRICE_TIERS[price][2]] : null,
    tag: search.get('tag')?.slice(0, 30) || null,
    map: search.get('map')?.slice(0, 30) || null,
    savedBy,
  }).catch(() => null)
  return redirect(id ? `${list}/${id}` : `${list}#loadout-browse`)
}
