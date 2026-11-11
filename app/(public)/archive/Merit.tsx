import styles from './merit.module.css'

const DONATIONS = [
  { name: 'SonicZhan', date: '2025-03-12', amount: 1400 },
  { name: '我也想成为抖音高手', date: '2025-03-12', amount: 200 },
  { name: 'ChromosomeX', date: '2025-03-12', amount: 50 },
  {
    name: 'chopper',
    date: '2025-03-14',
    amount: '五张贴纸',
    note: '五张彩虹之径（≈31.4），捐给亚军',
  },
  { name: '凤年扶墙而走', date: '2025-03-16', amount: 100 },
  { name: 'Aleksib', date: '2025-03-17', amount: 100 },
]

const cashTotal = DONATIONS.reduce(
  (sum, donation) => sum + (typeof donation.amount === 'number' ? donation.amount : 0),
  0,
)

export function Merit() {
  return (
    <section className="section" id="merit">
      <div className="wrap">
        <section aria-labelledby="edition-title" className={styles.edition}>
          <div className={styles.heading}>
            <div>
              <p className={styles.year}>第三届宁理杯 · 2025</p>
              <h2 id="edition-title">功德榜</h2>
            </div>
            <p className={styles.summary}>
              {DONATIONS.length} 位捐赠者 · 现金 <strong>{cashTotal} 元</strong> · 贴纸 5 张
            </p>
          </div>
          <table className={styles.table}>
            <caption>按原始明细顺序展示，物品捐赠不计入现金合计。</caption>
            <thead>
              <tr>
                <th scope="col">捐赠者</th>
                <th scope="col">捐赠内容</th>
                <th scope="col">日期</th>
              </tr>
            </thead>
            <tbody>
              {DONATIONS.map(donation => (
                <tr key={donation.name}>
                  <th scope="row">{donation.name}</th>
                  <td>
                    <span className={styles.contribution}>
                      {typeof donation.amount === 'number'
                        ? `${donation.amount} 元`
                        : donation.amount}
                    </span>
                    {donation.note ? <p className={styles.note}>{donation.note}</p> : null}
                  </td>
                  <td className={styles.date}>
                    <time dateTime={donation.date}>{donation.date}</time>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>
      </div>
    </section>
  )
}
