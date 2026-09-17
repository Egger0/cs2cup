import styles from './LoadoutHero.module.css'

export function HeroBuild({
  shot,
  render = null,
  weapon,
}: {
  shot: string | null
  render?: string | null
  weapon: string | null
}) {
  if (shot) {
    return (
      <span className={styles.plate}>
        <img src={shot} alt="" fetchPriority="high" decoding="async" />
      </span>
    )
  }
  if (render) {
    return (
      <img
        className={styles.render}
        src={render}
        alt=""
        referrerPolicy="no-referrer"
        fetchPriority="high"
        decoding="async"
      />
    )
  }
  return weapon ? (
    <>
      <img className={styles.ghost} src={weapon} alt="" fetchPriority="high" decoding="async" />
      <span className={styles.ghostNote}>底枪示意 · 非改装效果</span>
    </>
  ) : null
}

export function HeroStats({ items }: { items: readonly (readonly [string, string | number])[] }) {
  return (
    <span className={styles.stats}>
      {items.map(([label, value]) => (
        <span key={label} className={styles.stat}>
          <b>{typeof value === 'number' ? String(value).padStart(2, '0') : value}</b>
          <span>{label}</span>
        </span>
      ))}
    </span>
  )
}
