'use client'

import { useState, useTransition } from 'react'
import { Button, Field } from '@/components/ui'
import type { SiteSetting } from '@/lib/types'
import { updateSiteSetting } from '../actions/settings'
import styles from '../admin.module.css'

export function SettingsForm({ setting }: { setting: SiteSetting }) {
  const [pending, startTransition] = useTransition()
  const [saved, setSaved] = useState(false)
  const [error, setError] = useState('')

  return (
    <form
      className={styles.editor}
      action={formData =>
        startTransition(async () => {
          setSaved(false)
          setError('')
          try {
            await updateSiteSetting(formData)
            setSaved(true)
          } catch {
            setError('保存失败，请检查网络后重试。')
          }
        })
      }
    >
      <div className={styles.pair}>
        <Field
          id="st-name"
          name="clubName"
          label="社团名称"
          defaultValue={setting.clubName}
          required
        />
        <Field
          id="st-en"
          name="clubNameEn"
          label="英文名"
          defaultValue={setting.clubNameEn ?? ''}
        />
      </div>
      <Field id="st-school" name="school" label="学校" defaultValue={setting.school} required />
      <div className={styles.pair}>
        <Field id="st-qq" name="contactQq" label="QQ 群" defaultValue={setting.contactQq ?? ''} />
        <Field
          id="st-wechat"
          name="contactWechat"
          label="负责人微信"
          defaultValue={setting.contactWechat ?? ''}
        />
      </div>
      <Field
        id="st-footer"
        name="footerCopy"
        label="页脚版权"
        defaultValue={setting.footerCopy ?? ''}
      />
      <div className={styles.rowActions}>
        <Button type="submit" variant="primary" disabled={pending}>
          {pending ? '保存中…' : '保存'}
        </Button>
        {saved ? (
          <span className={styles.ok} role="status">
            已保存
          </span>
        ) : null}
        {error ? (
          <span className={styles.error} role="alert">
            {error}
          </span>
        ) : null}
      </div>
    </form>
  )
}
