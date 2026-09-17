import { formatPrice } from '@/lib/delta-loadouts'
import type { listLoadoutAccessories } from '@/lib/loadout-queries'
import styles from './accessories.module.css'

export function LoadoutAccessories({
  items,
}: {
  items: Awaited<ReturnType<typeof listLoadoutAccessories>>
}) {
  if (!items.length) return null
  const counts = new Map<number, number>()
  for (const item of items) counts.set(item.id, (counts.get(item.id) ?? 0) + 1)
  const grouped = items
    .filter((item, index) => items.findIndex(other => other.id === item.id) === index)
    .map(item => ({ ...item, count: counts.get(item.id) ?? 1 }))
  return (
    <section className={styles.panel} aria-labelledby="loadout-accessories">
      <h2 id="loadout-accessories">
        配件清单 <small>{items.length} 件</small>
      </h2>
      <ol className={styles.list}>
        {grouped.map(item => (
          <li key={item.id} className={styles.item} data-grade={item.grade}>
            {item.imageUrl ? (
              <img
                src={item.imageUrl}
                alt=""
                loading="lazy"
                decoding="async"
                referrerPolicy="no-referrer"
              />
            ) : (
              <span className={styles.blank} aria-hidden="true" />
            )}
            <div>
              <p className={styles.name}>
                <span>{item.slot}</span>
                {item.name}
                {item.count > 1 ? <b> ×{item.count}</b> : null}
              </p>
              {item.effects.length ? (
                <ul className={styles.effects}>
                  {item.effects.map(effect => (
                    <li key={effect.value} data-positive={effect.positive ? '' : undefined}>
                      {effect.value}
                    </li>
                  ))}
                </ul>
              ) : null}
            </div>
            {item.price ? <span className={styles.price}>{formatPrice(item.price)}</span> : null}
          </li>
        ))}
      </ol>
    </section>
  )
}
