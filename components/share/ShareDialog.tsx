'use client'

import Image from 'next/image'
import { useEffect, useId, useRef, useState } from 'react'
import { CLUB_BRAND } from '@/lib/brand'
import type { PublicShare } from '@/lib/share-poster'
import { Icon } from '@/components/ui/Icon'
import styles from './Share.module.css'

export function ShareDialog({
  share,
  onClose,
  accessTips,
}: {
  share: PublicShare
  onClose(): void
  accessTips: boolean
}) {
  const dialog = useRef<HTMLDialogElement>(null)
  const link = useRef<HTMLInputElement>(null)
  const heading = useId()
  const description = useId()
  const [poster, setPoster] = useState<string | null>(null)
  const [imageError, setImageError] = useState(false)
  const [message, setMessage] = useState('')
  const [canShare, setCanShare] = useState(false)

  useEffect(() => {
    const element = dialog.current
    element?.showModal()
    const previousOverflow = document.documentElement.style.overflow
    document.documentElement.style.overflow = 'hidden'
    let disposed = false
    let objectUrl: string | undefined
    import('@/lib/share-poster')
      .then(async ({ createSharePoster }) => {
        const blob = await createSharePoster(share)
        if (disposed) return
        objectUrl = URL.createObjectURL(blob)
        setPoster(objectUrl)
      })
      .catch(() => {
        if (!disposed) setImageError(true)
      })
    Promise.resolve().then(() => {
      if (!disposed) setCanShare(typeof navigator.share === 'function')
    })
    return () => {
      disposed = true
      if (objectUrl) URL.revokeObjectURL(objectUrl)
      document.documentElement.style.overflow = previousOverflow
    }
  }, [share])

  async function copyLink() {
    try {
      await navigator.clipboard.writeText(share.url)
      setMessage('链接已复制，可以发送给队友了。')
    } catch {
      link.current?.focus()
      link.current?.select()
      setMessage('请复制下方选中的链接。')
    }
  }

  async function systemShare() {
    try {
      await navigator.share({
        title: `${share.title} · ${CLUB_BRAND.shortName}`,
        text: share.text,
        url: share.url,
      })
    } catch (error) {
      if (!(error instanceof Error && error.name === 'AbortError')) {
        setMessage('暂时无法打开系统分享，请复制链接或保存图片。')
      }
    }
  }

  return (
    <dialog
      ref={dialog}
      className={styles.dialog}
      aria-labelledby={heading}
      aria-describedby={description}
      onClose={onClose}
      onClick={event => {
        if (event.target === event.currentTarget) dialog.current?.close()
      }}
    >
      <div>
        <div className={styles.heading}>
          <div>
            <span className={styles.eyebrow}>PASS THE PASSION</span>
            <h2 id={heading}>{accessTips ? '下一次，轻松找到我们。' : '好比赛，叫上队友。'}</h2>
          </div>
          <button
            type="button"
            aria-label="关闭分享"
            className={styles.close}
            onClick={() => dialog.current?.close()}
          >
            <Icon name="close" />
          </button>
        </div>
        <div className={styles.shareGrid}>
          <div className={styles.options}>
            <p id={description} className={styles.intro}>
              把链接发进群聊，或保存带二维码的图片。朋友扫码就能来到这里。
            </p>
            <button type="button" className={styles.primary} onClick={() => void copyLink()}>
              <Icon name="copy" />
              复制链接
            </button>
            {canShare ? (
              <button type="button" className={styles.option} onClick={() => void systemShare()}>
                <Icon name="share" />
                打开系统分享
              </button>
            ) : null}
            {poster ? (
              <a className={styles.option} href={poster} download="ningli-esports-share.png">
                <Icon name="download" />
                保存分享卡
              </a>
            ) : null}
            <label className={styles.linkLabel}>
              官网直达链接
              <input
                ref={link}
                value={share.url}
                readOnly
                onFocus={event => event.target.select()}
              />
            </label>
            <p role="status" className={styles.message}>
              {message}
            </p>
            {accessTips ? (
              <details className={styles.tips}>
                <summary>把官网放到手机主屏幕</summary>
                <p>
                  iPhone：在 Safari
                  的分享菜单中选择“添加到主屏幕”。Android：在浏览器菜单中选择“安装应用”或“添加到主屏幕”。
                </p>
                <p>电脑端可按 Ctrl + D（Mac 为 ⌘ + D）收藏官网。</p>
              </details>
            ) : null}
          </div>
          <div className={styles.preview}>
            {poster ? (
              <Image
                src={poster}
                alt={`${share.title}的分享卡，包含官网二维码`}
                width={720}
                height={900}
                unoptimized
              />
            ) : (
              <div className={styles.placeholder} role="status">
                <span>NINGLI / ESPORTS</span>
                <strong>{share.title}</strong>
                <p>{imageError ? '图片暂时无法生成，仍可分享链接。' : '正在制作分享卡…'}</p>
              </div>
            )}
          </div>
        </div>
      </div>
    </dialog>
  )
}
