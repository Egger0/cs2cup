'use client'

import { useSyncExternalStore } from 'react'

const STORAGE_KEY = 'cs2cup:followed-tournaments:v1'
const EMPTY = '[]'
const listeners = new Set<() => void>()

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

  function toggle(id: number): boolean {
    const current = parse(read())
    const next = current.includes(id) ? current.filter(value => value !== id) : [...current, id]
    try {
      window.localStorage.setItem(STORAGE_KEY, JSON.stringify(next.slice(-100)))
      listeners.forEach(listener => listener())
      return true
    } catch {
      return false
    }
  }

  return { ids, toggle }
}
