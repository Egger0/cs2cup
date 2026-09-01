import styles from './AdminPageHeader.module.css'

export function AdminPageHeader({
  index,
  title,
  description,
}: {
  index: string
  title: string
  description: string
}) {
  return (
    <header className={styles.header}>
      <p className={styles.index}>CONTROL / {index}</p>
      <div className={styles.copy}>
        <h1>{title}</h1>
        <p>{description}</p>
      </div>
    </header>
  )
}
