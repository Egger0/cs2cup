import type { ReactNode } from 'react'
import type { FaqItem, RuleItem } from '@/lib/types'
import styles from './Sections.module.css'

export function SectionHead({
  eyebrow,
  title,
  lede,
}: {
  eyebrow: string
  title: ReactNode
  lede?: string
}) {
  return (
    <div className={styles.head}>
      <span className={styles.eyebrow}>{eyebrow}</span>
      <h2 className={styles.title}>{title}</h2>
      {lede ? <p className={styles.lede}>{lede}</p> : null}
    </div>
  )
}

export interface StatItem {
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
