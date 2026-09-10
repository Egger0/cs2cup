import { formatSiteNumericDateTime } from '@/lib/datetime'
import type { ParticipantAccessReceipt } from '@/lib/queries/participant-account'
import styles from './access-receipt.module.css'

function accessTime(value: number) {
  if (!Number.isSafeInteger(value) || value < 0) return null
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return null
  const label = formatSiteNumericDateTime(value)
  return label ? { iso: date.toISOString(), label } : null
}

function DeviceReport({ receipt }: { receipt: ParticipantAccessReceipt }) {
  if (receipt.deviceType === 'multiDevice') {
    return receipt.backedUp ? (
      <p>
        最近一次设备报告：这把通行密钥具备多设备能力，并处于已备份状态。能否在其他设备使用由设备平台决定。
      </p>
    ) : (
      <p>最近一次设备报告：这把通行密钥具备多设备能力，但当时未报告已备份。</p>
    )
  }

  return <p>最近一次设备报告：这把通行密钥不具备多设备备份能力。</p>
}

export function AccessReceipt({
  receipt,
  sessionExpiresAt,
}: {
  receipt: ParticipantAccessReceipt
  sessionExpiresAt: number
}) {
  const createdAt = accessTime(receipt.credentialCreatedAt)
  const lastUsedAt =
    receipt.credentialLastUsedAt === null ? null : accessTime(receipt.credentialLastUsedAt)
  const expiresAt = accessTime(sessionExpiresAt)

  return (
    <section className={styles.receipt} aria-labelledby="access-receipt-title">
      <header className={styles.header}>
        <p>ACCESS RECEIPT / 本次访问凭条</p>
        <span className={styles.verified}>
          <i aria-hidden="true" /> 已验证
        </span>
      </header>

      <div className={styles.identity}>
        <div className={styles.keyMark} aria-hidden="true">
          <span>PK</span>
          <i />
        </div>
        <div>
          <p className={styles.overline}>CURRENT CREDENTIAL</p>
          <h2 id="access-receipt-title">由通行密钥确认</h2>
          <p className={styles.summary}>
            这张凭条只描述本次登录所使用的通行密钥，不包含凭据编号或设备生物识别信息。
          </p>
        </div>
      </div>

      <dl className={styles.facts}>
        <div className={styles.primaryFact}>
          <dt>状态</dt>
          <dd>访问已确认</dd>
        </div>
        <div>
          <dt>凭据建立</dt>
          <dd>
            {createdAt ? <time dateTime={createdAt.iso}>{createdAt.label}</time> : '记录不可用'}
          </dd>
        </div>
        <div>
          <dt>最近确认</dt>
          <dd>
            {lastUsedAt ? <time dateTime={lastUsedAt.iso}>{lastUsedAt.label}</time> : '建档时确认'}
          </dd>
        </div>
        <div className={styles.expiryFact}>
          <dt>访问有效至</dt>
          <dd>
            {expiresAt ? <time dateTime={expiresAt.iso}>{expiresAt.label}</time> : '本次会话内'}
          </dd>
        </div>
      </dl>

      <footer className={styles.device}>
        <span>{receipt.deviceType === 'multiDevice' ? 'MULTI DEVICE' : 'SINGLE DEVICE'}</span>
        <div>
          <strong>设备报告状态</strong>
          <DeviceReport receipt={receipt} />
        </div>
      </footer>

      <div className={styles.recoveryBoundary}>
        <span>RECOVERY / 恢复准备</span>
        <p>
          <strong>把报名管理链接和旧登录方式分开保管。</strong>
          通行密钥的备份与跨设备可用性由你的设备或平台管理，本站不会接触或代为找回。请妥善保留原报名管理链接；它是独立的报名管理入口，不是通行密钥备份。
        </p>
      </div>

      <p className={styles.sessionNote}>
        访问到期后，如这把通行密钥仍可用，可再次由设备确认；你的报名记录不会因会话到期而改变。
      </p>
    </section>
  )
}
