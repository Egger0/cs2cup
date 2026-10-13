'use client'

import { useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { Button, Field, TextField } from '@/components/ui'
import type { GraphicsPreset } from '@/lib/graphics-presets'
import { GRAPHICS_SETTINGS_LIMIT } from '@/lib/graphics-settings'
import type { Game } from '@/lib/types'
import { saveGraphicsPreset } from '../actions/graphics'
import styles from '../admin.module.css'

const SETTINGS_EXAMPLE = `# 基础画质
阴影质量 = 低
# 高级画质
超分辨率 = DLSS 质量`

export function GraphicsPresetForm({ games, preset }: { games: Game[]; preset?: GraphicsPreset }) {
  const router = useRouter()
  const [pending, startTransition] = useTransition()
  const [feedback, setFeedback] = useState<{ ok: boolean; message: string } | null>(null)
  const key = preset?.id ?? 'new'

  return (
    <form
      className={styles.editor}
      aria-busy={pending}
      onSubmit={event => {
        event.preventDefault()
        const form = event.currentTarget
        startTransition(async () => {
          setFeedback(null)
          try {
            const result = await saveGraphicsPreset(preset?.id ?? null, new FormData(form))
            if (!result.ok) {
              setFeedback({ ok: false, message: result.error })
              return
            }
            if (!preset) form.reset()
            setFeedback({ ok: true, message: '已保存' })
            router.refresh()
          } catch {
            setFeedback({ ok: false, message: '保存失败，请检查网络后重试。' })
          }
        })
      }}
    >
      <div className={styles.pair}>
        <label className={styles.controlLabel}>
          项目
          <select
            name="gameId"
            required
            className={styles.select}
            disabled={pending}
            defaultValue={preset?.gameId}
          >
            {games.map(game => (
              <option key={game.id} value={game.id}>
                {game.name}
              </option>
            ))}
          </select>
        </label>
        <Field
          id={`gp-title-${key}`}
          name="title"
          label="方案名"
          required
          maxLength={60}
          placeholder="例：中端显卡稳 144 帧"
          defaultValue={preset?.title}
          disabled={pending}
        />
      </div>
      <div className={styles.pair}>
        <Field
          id={`gp-hardware-${key}`}
          name="hardware"
          label="适用配置"
          required
          maxLength={80}
          placeholder="例：RTX 4060 · i5-12400F · 1080p"
          defaultValue={preset?.hardware}
          disabled={pending}
        />
        <Field
          id={`gp-target-${key}`}
          name="target"
          label="实测帧数"
          hint="选填"
          maxLength={40}
          placeholder="例：烽火地带 140–165 帧"
          defaultValue={preset?.target}
          disabled={pending}
        />
      </div>
      <TextField
        id={`gp-settings-${key}`}
        name="settings"
        label="设置清单"
        hint="每行「设置项 = 取值」，以 # 开头的行是分组名"
        required
        rows={10}
        maxLength={GRAPHICS_SETTINGS_LIMIT}
        placeholder={SETTINGS_EXAMPLE}
        defaultValue={preset?.settings}
        disabled={pending}
      />
      <div className={styles.pair}>
        <Field
          id={`gp-author-${key}`}
          name="author"
          label="署名"
          hint="选填"
          maxLength={30}
          defaultValue={preset?.author}
          disabled={pending}
        />
        <Field
          id={`gp-note-${key}`}
          name="note"
          label="说明"
          hint="选填，取舍和注意事项"
          maxLength={300}
          defaultValue={preset?.note}
          disabled={pending}
        />
      </div>
      <div className={styles.rowActions}>
        <Button type="submit" variant="primary" disabled={pending}>
          {pending ? '保存中…' : preset ? '保存修改' : '发布方案'}
        </Button>
        {feedback ? (
          <span
            className={feedback.ok ? styles.ok : styles.error}
            role={feedback.ok ? 'status' : 'alert'}
          >
            {feedback.message}
          </span>
        ) : null}
      </div>
    </form>
  )
}
