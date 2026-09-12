import Image from 'next/image'
import { Icon } from '@/components/ui/Icon'
import type { SiteHeaderProps } from './SiteHeader'
import { SiteHeaderFallback } from './SiteHeaderFallback'
import { SiteHeaderLoader } from './SiteHeaderLoader'
import { AccountPortal } from './AccountPortal'
import styles from './SiteHeader.module.css'
import searchStyles from './HeaderSearch.module.css'
import './StarMap.module.css'

export function SiteHeaderEntry(props: SiteHeaderProps) {
  const { setting, links, accountLink } = props
  const usesDefaultMark = !setting.logoUrl || setting.logoUrl === '/brand/club-logo.jpg'
  const brandName = setting.clubName === '宁波理工电竞社' ? '宁理电竞社' : setting.clubName
  return (
    <SiteHeaderLoader
      {...props}
      fallback={
        <header className={styles.dock} data-basic-site-header>
          <div className={styles.inner} data-layout-container>
            <a href="/" className={styles.brand}>
              <span className={styles.mark}>
                <Image
                  src={usesDefaultMark ? '/brand/club-mark.svg' : setting.logoUrl!}
                  alt=""
                  width={72}
                  height={72}
                  className={usesDefaultMark ? styles.defaultMark : undefined}
                  priority
                />
              </span>
              <span className={styles.names}>
                <span>{brandName}</span>
                <small className={styles.school}>{setting.clubNameEn ?? 'ESPORTS CLUB'}</small>
              </span>
            </a>
            <div className={styles.actions}>
              <a href="/search" aria-label="搜索赛事、战队和动态" className={searchStyles.search}>
                <Icon name="search" size={18} />
              </a>
              <AccountPortal href={accountLink.href} label={accountLink.label} />
              <SiteHeaderFallback links={links} />
            </div>
          </div>
        </header>
      }
    />
  )
}
