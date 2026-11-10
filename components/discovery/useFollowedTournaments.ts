'use client'

import { useEffect, useSyncExternalStore } from 'react'

const STORAGE_KEY = 'cs2cup:followed-tournaments:v1'
const EMPTY = '[]'
const listeners = new Set<() => void>()
const ENDPOINT = '/api/account/follows'
let signedIn = false
let synced: Promise<void> | null = null

function write(ids: number[]) {
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(ids.slice(-100)))
    listeners.forEach(listener => listener())
    return true
  } catch {
    return false
  }
}

function post(body: { follow: number[]; unfollow?: number }) {
  return fetch(ENDPOINT, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
    .then(response => (response.ok ? (response.json() as Promise<{ ids: number[] }>) : null))
    .catch(() => null)
}

function syncWithAccount() {
  synced ??= fetch(ENDPOINT, { cache: 'no-store' })
    .then(response => response.json() as Promise<{ signedIn: boolean; ids: number[] }>)
    .then(async account => {
      signedIn = account.signedIn
      if (!signedIn) return
      const local = parse(read())
      const merged = await post({ follow: local })
      write([...new Set([...local, ...(merged?.ids ?? account.ids)])])
    })
    .catch(() => {})
  return synced
}

function read() {
  try {
    return window.localStorage.getItem(STORAGE_KEY) ?? EMPTY
  } catch {
    return EMPTY
  }
}

function parse(value: string): number[] {
  try {
    const parsed: unknown = JSON.parse(value)
    return Array.isArray(parsed)
      ? parsed.filter((id): id is number => Number.isSafeInteger(id) && id > 0).slice(0, 100)
      : []
  } catch {
    return []
  }
}

function subscribe(listener: () => void) {
  listeners.add(listener)
  const onStorage = (event: StorageEvent) => {
    if (event.key === STORAGE_KEY || event.key === null) listener()
  }
  window.addEventListener('storage', onStorage)
  return () => {
    listeners.delete(listener)
    window.removeEventListener('storage', onStorage)
  }
}

export function useFollowedTournaments() {
  const saved = useSyncExternalStore(subscribe, read, () => EMPTY)
  const ids = parse(saved)

  useEffect(() => {
    void syncWithAccount()
  }, [])

  function toggle(id: number): boolean {
    const current = parse(read())
    const following = current.includes(id)
    const next = following ? current.filter(value => value !== id) : [...current, id]
    const saved = write(next.slice(-100))
    if (saved && signedIn) void post(following ? { follow: [], unfollow: id } : { follow: [id] })
    return saved
  }

  return { ids, toggle }
}
