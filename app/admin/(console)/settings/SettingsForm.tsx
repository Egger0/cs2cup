'use client'

import { useState, useTransition } from 'react'
import { Button, Field } from '@/components/ui'
import { useUnsavedChangesWarning } from '@/components/admin/useUnsavedChangesWarning'
import type { SiteSetting } from '@/lib/types'
import { syncQqCommandPanel, updateSiteSetting } from '../actions/settings'
import styles from '../admin.module.css'

export function SettingsForm({ setting }: { setting: SiteSetting }) {
  const [pending, startTransition] = useTransition()
  const [saved, setSaved] = useState(false)
  const [error, setError] = useState('')
  const [dirty, setDirty] = useState(false)
  const [qqSynced, setQqSynced] = useState(false)

  useUnsavedChangesWarning(dirty, '站点设置还有未保存的更改，离开将丢失这些内容。')

  return (
    <form
      className={styles.editor}
      onChange={() => {
        setDirty(true)
        setSaved(false)
        setError('')
      }}
      action={formData =>
        startTransition(async () => {
          setSaved(false)
          setError('')
          try {
            await updateSiteSetting(formData)
            setSaved(true)
            setDirty(false)
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
        <Button
          type="reset"
          disabled={pending || !dirty}
          onClick={() => {
            setDirty(false)
            setSaved(false)
            setError('')
          }}
        >
          撤销更改
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
      <div className={styles.rowActions}>
        <Button
          type="button"
          disabled={pending}
          onClick={() =>
            startTransition(async () => {
              setError('')
              setQqSynced(false)
              try {
                await syncQqCommandPanel()
                setQqSynced(true)
              } catch {
                setError('QQ 指令面板同步失败，请稍后重试。')
              }
            })
          }
        >
          {pending ? '同步中…' : '同步 QQ 指令面板'}
        </Button>
        {qqSynced ? (
          <span className={styles.ok} role="status">
            QQ 群指令面板已同步
          </span>
        ) : null}
      </div>
    </form>
  )
}
