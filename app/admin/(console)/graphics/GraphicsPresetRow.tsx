'use client'

import { useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { Button } from '@/components/ui'
import type { GraphicsPreset } from '@/lib/graphics-presets'
import type { Game } from '@/lib/types'
import { removeGraphicsPreset } from '../actions/graphics'
import { GraphicsPresetForm } from './GraphicsPresetForm'
import styles from '../admin.module.css'

export function GraphicsPresetRow({ preset, games }: { preset: GraphicsPreset; games: Game[] }) {
  const router = useRouter()
  const [pending, startTransition] = useTransition()
  const [open, setOpen] = useState(false)
  const [error, setError] = useState('')
  const game = games.find(entry => entry.id === preset.gameId)

  return (
    <>
      <div className={styles.listRow}>
        <div>
          <div className={styles.listTitle}>{preset.title}</div>
          <div className={styles.listMeta}>
            {game?.name ?? '项目已删除'} · {preset.hardware}
          </div>
        </div>
        <div className={styles.rowActions}>
          <Button size="mini" aria-expanded={open} onClick={() => setOpen(!open)}>
            {open ? '收起' : '编辑'}
          </Button>
          <Button
            size="mini"
            variant="danger"
            disabled={pending}
            aria-busy={pending}
            onClick={() => {
              if (!confirm(`删除「${preset.title}」？`)) return
              startTransition(async () => {
                setError('')
                try {
                  const result = await removeGraphicsPreset(preset.id)
                  if (result.ok) router.refresh()
                  else setError(result.error)
                } catch {
                  setError('删除失败，请检查网络后重试。')
                }
              })
            }}
          >
            {pending ? '删除中…' : '删除'}
          </Button>
          {error ? (
            <span className={styles.error} role="alert">
              {error}
            </span>
          ) : null}
        </div>
      </div>
      {open ? <GraphicsPresetForm games={games} preset={preset} /> : null}
    </>
  )
}
