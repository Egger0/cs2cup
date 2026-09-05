import Image from 'next/image'
import { Icon } from '@/components/ui/Icon'
import { Badge } from '@/components/ui'
import type { SiteHeaderProps } from './SiteHeader'
import { SiteHeaderFallback } from './SiteHeaderFallback'
import { SiteHeaderLoader } from './SiteHeaderLoader'
import styles from './SiteHeader.module.css'
import passStyles from './SitePassLink.module.css'
import searchStyles from './HeaderSearch.module.css'

export function SiteHeaderEntry(props: SiteHeaderProps) {
  const { setting, links, accountLink, status } = props
  const usesDefaultMark = !setting.logoUrl || setting.logoUrl === '/brand/club-logo.jpg'
  const brandName = setting.clubName === '宁波理工电竞社' ? '宁理电竞社' : setting.clubName
  const primaryLinks = links.filter(link =>
    ['/tournaments', '/news', '/archive'].includes(link.href),
  )
  const [codeLead, codeTail] = accountLink.code.split(' / ', 2)
  return (
    <SiteHeaderLoader
      {...props}
      fallback={
        <header className={styles.header} data-basic-site-header>
          <div className={styles.inner}>
            {/* Native document navigation must not depend on a client chunk. */}
            {/* eslint-disable-next-line @next/next/no-html-link-for-pages */}
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
            <nav className={styles.primaryNav} aria-label="主要导航">
              {primaryLinks.map((link, index) => (
                <a key={link.href} href={link.href}>
                  <span>{String(index + 1).padStart(2, '0')}</span>
                  {link.label}
                </a>
              ))}
            </nav>
            <div className={styles.actions}>
              <a href="/search" aria-label="搜索赛事、战队和动态" className={searchStyles.search}>
                <Icon name="search" size={18} />
              </a>
              {status ? (
                <Badge tone={status.open ? 'ct' : 'neutral'} dot>
                  {status.label}
                </Badge>
              ) : null}
              <a href={accountLink.href} className={passStyles.pass}>
                <small className={passStyles.code} aria-hidden="true">
                  <span>{codeLead} / </span>
                  {codeTail}
                </small>
                <span className={passStyles.label}>{accountLink.label}</span>
              </a>
              <SiteHeaderFallback links={links} />
            </div>
          </div>
        </header>
      }
    />
  )
}
