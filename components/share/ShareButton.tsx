'use client'

import { useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { Icon } from '@/components/ui/Icon'
import type { PublicShare } from '@/lib/share-poster'
import { ShareDialog } from './ShareDialog'
import styles from './Share.module.css'

export function ShareButton({
  share,
  children = '分享',
  accessTips = false,
}: {
  share: PublicShare
  children?: React.ReactNode
  accessTips?: boolean
}) {
  const [open, setOpen] = useState(false)
  const trigger = useRef<HTMLButtonElement>(null)
  return (
    <>
      <button
        ref={trigger}
        type="button"
        className={styles.trigger}
        aria-haspopup="dialog"
        onClick={() => setOpen(true)}
      >
        <Icon name="share" />
        {children}
      </button>
      {open
        ? createPortal(
            <ShareDialog
              share={share}
              accessTips={accessTips}
              onClose={() => {
                setOpen(false)
                trigger.current?.focus({ preventScroll: true })
              }}
            />,
            document.body,
          )
        : null}
    </>
  )
}
