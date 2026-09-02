import headerStyles from './SiteHeader.module.css'
import styles from './SiteHeaderFallback.module.css'

export interface SiteNavLink {
  href: string
  label: string
}

export function SiteHeaderFallback({ links }: { links: SiteNavLink[] }) {
  return (
    <details className={styles.fallback} data-site-header-fallback>
      <summary className={headerStyles.toggle} aria-label="基础站点目录">
        <span className={headerStyles.toggleLabel}>目录</span>
        <small>{String(links.length).padStart(2, '0')}</small>
        <span className={headerStyles.menuIcon} data-fallback-menu-icon aria-hidden="true">
          <i />
          <i />
        </span>
      </summary>

      <nav className={styles.panel} aria-label="基础站点目录链接">
        <div className={styles.meta}>
          <span>BASIC INDEX / {String(links.length).padStart(2, '0')}</span>
          <small>客户端界面未就绪，链接仍可直接访问</small>
        </div>
        <ol className={styles.links}>
          {links.map((link, index) => (
            <li key={link.href}>
              <a href={link.href}>
                <span aria-hidden="true">{String(index + 1).padStart(2, '0')}</span>
                <strong>{link.label}</strong>
                <i aria-hidden="true">↗</i>
              </a>
            </li>
          ))}
        </ol>
      </nav>
    </details>
  )
}
