import styles from './HomeBackdrop.module.css'

export function HomeBackdrop() {
  return (
    <div className={styles.backdrop} data-solar-home aria-hidden="true">
      <span className={styles.star} />
      <span className={styles.still} />
    </div>
  )
}
