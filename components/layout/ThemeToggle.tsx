'use client'

import { useSyncExternalStore } from 'react'
import styles from './ThemeToggle.module.css'

const OPTIONS = [
  { value: 'auto', label: '自动' },
  { value: 'light', label: '浅色' },
  { value: 'dark', label: '深色' },
] as const

type Choice = (typeof OPTIONS)[number]['value']

const listeners = new Set<() => void>()

function read(): Choice {
  const value = document.documentElement.dataset.theme
  return value === 'light' || value === 'dark' ? value : 'auto'
}

function subscribe(listener: () => void) {
  listeners.add(listener)
  return () => listeners.delete(listener)
}

function choose(value: Choice) {
  const root = document.documentElement
  if (value === 'auto') delete root.dataset.theme
  else root.dataset.theme = value
  try {
    if (value === 'auto') localStorage.removeItem('theme')
    else localStorage.setItem('theme', value)
  } catch {}
  listeners.forEach(listener => listener())
}

export function ThemeToggle() {
  const current = useSyncExternalStore(subscribe, read, () => 'auto' as Choice)
  return (
    <div className={styles.group} role="group" aria-label="外观">
      {OPTIONS.map(option => (
        <button
          key={option.value}
          type="button"
          aria-pressed={current === option.value}
          onClick={() => choose(option.value)}
        >
          {option.label}
        </button>
      ))}
    </div>
  )
}
