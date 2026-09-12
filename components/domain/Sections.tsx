import type { CSSProperties, ReactNode } from 'react'
import theme from '@/app/site-theme.module.css'
import type { FaqItem, RuleItem } from '@/lib/types'
import arrival from './Arrival.module.css'
import styles from './Sections.module.css'

interface HeadingCopy {
  eyebrow?: string
  title: ReactNode
  lede?: string
}

export function PageMasthead({
  eyebrow,
  title,
  lede,
  code,
  tone,
  art,
  children,
  density = 'spacious',
  plain = false,
}: HeadingCopy & {
  code?: string
  tone?: string
  art?: ReactNode
  children?: ReactNode
  density?: 'spacious' | 'compact'
  plain?: boolean
}) {
  if (plain)
    return (
      <header
        className={`${styles.pageHead} ${density === 'compact' ? styles.pageHeadCompact : ''}`}
      >
        {eyebrow ? <span className={styles.eyebrow}>{eyebrow}</span> : null}
        <h1 className={styles.pageTitle}>{title}</h1>
        {lede ? <p className={styles.pageLede}>{lede}</p> : null}
      </header>
    )
  return (
    <header
      className={arrival.arrival}
      data-arrival
      data-density={density}
      style={tone ? ({ '--tone': tone } as CSSProperties) : undefined}
    >
      <div className={arrival.sky} aria-hidden="true" />
      <div className={art ? arrival.art : arrival.limb} aria-hidden="true">
        {art}
      </div>
      {code ? (
        <span className={arrival.code} aria-hidden="true">
          {code}
        </span>
      ) : null}
      <div className={`wrap ${theme.dark} ${arrival.copy}`}>
        {eyebrow ? <span className={arrival.eyebrow}>{eyebrow}</span> : null}
        <h1 className={arrival.title}>{title}</h1>
        {lede ? <p className={arrival.lede}>{lede}</p> : null}
        {children ? <div className={arrival.aside}>{children}</div> : null}
      </div>
      <div className={arrival.horizon} aria-hidden="true" />
    </header>
  )
}

export function SectionHead({ eyebrow, title, lede }: HeadingCopy) {
  return (
    <div className={styles.head}>
      {eyebrow ? <span className={styles.eyebrow}>{eyebrow}</span> : null}
      <h2 className={styles.title}>{title}</h2>
      {lede ? <p className={styles.lede}>{lede}</p> : null}
    </div>
  )
}

interface StatItem {
  value: string
  unit?: string
  key: string
}

export function StatRow({ items }: { items: StatItem[] }) {
  return (
    <div className={styles.stats}>
      {items.map(item => (
        <div key={item.key} className={styles.stat}>
          <div>
            <span className={styles.statValue}>{item.value}</span>
            {item.unit ? <span className={styles.statUnit}>{item.unit}</span> : null}
          </div>
          <div className={styles.statKey}>{item.key}</div>
        </div>
      ))}
    </div>
  )
}

export function RuleGrid({ rules }: { rules: RuleItem[] }) {
  return (
    <div className={styles.rules}>
      {rules.map(rule => (
        <article key={rule.title} className={styles.rule}>
          <div className={styles.ruleLabel}>{rule.label}</div>
          <h3 className={styles.ruleTitle}>{rule.title}</h3>
          <p className={styles.ruleBody}>{rule.body}</p>
        </article>
      ))}
    </div>
  )
}

export function FaqList({ faqs }: { faqs: FaqItem[] }) {
  return (
    <div className={styles.faq}>
      {faqs.map(faq => (
        <details key={faq.question} className={styles.faqItem}>
          <summary>
            {faq.question}
            <span className={styles.faqSign} aria-hidden>
              +
            </span>
          </summary>
          <p className={styles.faqBody}>{faq.answer}</p>
        </details>
      ))}
    </div>
  )
}
