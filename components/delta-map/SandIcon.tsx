import type { CSSProperties } from 'react'
import { ICON_ATLAS, SAND_KINDS, type SandKind } from '@/lib/delta-sand'
import styles from './SandHud.module.css'

export function SandIcon({
  icon,
  kind,
  size = 28,
}: {
  icon: number
  kind: SandKind
  size?: number
}) {
  const style = {
    '--size': `${size}px`,
    '--tone': SAND_KINDS[kind].color,
    '--column': icon % ICON_ATLAS.columns,
    '--row': Math.floor(icon / ICON_ATLAS.columns),
    '--atlas': `url(${ICON_ATLAS.url})`,
  } as CSSProperties
  return <span className={styles.icon} style={style} data-empty={icon < 0} aria-hidden="true" />
}
