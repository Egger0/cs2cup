import styles from './loading.module.css'

export default function Loading() {
  return (
    <div className={`wrap ${styles.shell}`} aria-busy="true" aria-label="加载中">
      <div className={`${styles.bar} ${styles.title}`} />
      <div className={`${styles.bar} ${styles.line}`} />
      <div className={`${styles.bar} ${styles.line} ${styles.short}`} />
      <div className={styles.grid}>
        {[0, 1, 2, 3, 4, 5].map(i => (
          <div key={i} className={`${styles.bar} ${styles.card}`} />
        ))}
      </div>
    </div>
  )
}
