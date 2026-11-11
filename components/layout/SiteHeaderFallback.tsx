import headerStyles from './SiteHeader.module.css'
import styles from './SiteHeaderFallback.module.css'

export interface SiteNavLink {
  href: string
  label: string
  group?: string
}

export function SiteHeaderFallback({ links }: { links: SiteNavLink[] }) {
  return (
    <details className={styles.fallback} data-site-header-fallback>
      <summary className={headerStyles.toggle} aria-label="基础站点目录">
        <span className={headerStyles.menuIcon} aria-hidden="true" />
      </summary>

      <nav className={styles.panel} aria-label="基础站点目录链接">
        <div className={styles.meta}>
          <small>客户端界面未就绪，链接仍可直接访问</small>
        </div>
        <ol className={styles.links}>
          {links.map(link => (
            <li key={link.href}>
              <a href={link.href}>
                <strong>{link.label}</strong>
              </a>
            </li>
          ))}
        </ol>
      </nav>
    </details>
  )
}
