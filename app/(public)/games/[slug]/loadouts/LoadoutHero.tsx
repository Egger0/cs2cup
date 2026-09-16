import styles from './LoadoutHero.module.css'

export function HeroWeapon({ image }: { image: string }) {
  return <img className={styles.weapon} src={image} alt="" fetchPriority="high" decoding="async" />
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
