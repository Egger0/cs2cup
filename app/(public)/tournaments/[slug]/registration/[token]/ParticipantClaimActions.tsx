import Link from 'next/link'
import type { RefObject } from 'react'

import ownershipStyles from './claim-ownership.module.css'
import styles from './claim-passkey.module.css'

export type ParticipantEntryOwnershipState =
  | 'anonymous-unclaimed'
  | 'signed-in-unclaimed'
  | 'owned-by-current'
  | 'owned-by-other'
export type SupportState = 'checking' | 'supported' | 'unsupported'
export type ClaimState = 'idle' | 'working' | 'error'
export type AttachState = 'idle' | 'confirming' | 'working' | 'error'
export type SwitchState = 'idle' | 'working' | 'error'

const CLAIM_ERROR = '没有完成创建。报名和管理链接都没有变化，可以再次尝试。'
const ATTACH_ERROR = '暂时没能加入。报名和管理链接都没有变化，请稍后重试。'
const SWITCH_ERROR = '暂时没能退出当前通行证，请稍后重试。'

export function AnonymousClaimAction({
  support,
  claimState,
  loginHref,
  onCreate,
}: {
  support: SupportState
  claimState: ClaimState
  loginHref: string
  onCreate: () => void
}) {
  const working = claimState === 'working'
  const createLabel =
    support === 'checking'
      ? '正在检查这台设备…'
      : support === 'unsupported'
        ? '当前设备暂不可用'
        : working
          ? '正在等待设备确认…'
          : '创建赛事通行证'

  return (
    <div className={ownershipStyles.choice}>
      <div>
        <strong>已有赛事通行证？</strong>
        <p>先登录，再把多份报名放进同一份赛事卷宗。</p>
      </div>
      <Link className={ownershipStyles.loginLink} href={loginHref}>
        登录并加入 <span aria-hidden="true">↗</span>
      </Link>
      <span className={ownershipStyles.orRule}>第一次使用</span>
      <button
        type="button"
        className={styles.claimButton}
        disabled={support !== 'supported' || working}
        onClick={onCreate}
        aria-describedby="passkey-claim-status passkey-claim-notes"
      >
        <span className={styles.keyMark} aria-hidden="true">
          PK
        </span>
        <span>{createLabel}</span>
        <span aria-hidden="true">↗</span>
      </button>
      <div id="passkey-claim-status" className={styles.actionStatus} aria-live="polite">
        {support === 'checking' ? <p>正在确认浏览器的通行密钥能力。</p> : null}
        {support === 'unsupported' ? <p>请换用支持通行密钥的浏览器或设备。</p> : null}
        {support === 'supported' && claimState === 'idle' ? (
          <p>创建时会打开设备的系统验证界面。</p>
        ) : null}
        {claimState === 'error' ? (
          <p className={styles.error} role="alert">
            {CLAIM_ERROR}
          </p>
        ) : null}
      </div>
    </div>
  )
}

export function SignedInAttachAction({
  attachState,
  switchState,
  teamTag,
  teamName,
  confirmButton,
  onArm,
  onCancel,
  onConfirm,
  onSwitch,
}: {
  attachState: AttachState
  switchState: SwitchState
  teamTag: string
  teamName: string
  confirmButton: RefObject<HTMLButtonElement | null>
  onArm: () => void
  onCancel: () => void
  onConfirm: () => void
  onSwitch: () => void
}) {
  const confirming = attachState === 'confirming' || attachState === 'working'
  const working = attachState === 'working'

  return (
    <div className={ownershipStyles.attach}>
      <p className={ownershipStyles.sessionMark}>CURRENT PASS / 已登录</p>
      {confirming ? (
        <div className={ownershipStyles.confirmation} role="group" aria-labelledby="attach-title">
          <strong id="attach-title">
            确认收录 [{teamTag}] {teamName}？
          </strong>
          <p>归属写入后，目前不能自行转移。原管理链接仍可查看和修改报名。</p>
          <div className={ownershipStyles.confirmActions}>
            <button
              ref={confirmButton}
              type="button"
              className={ownershipStyles.confirmButton}
              disabled={working}
              onClick={onConfirm}
            >
              {working ? '正在加入…' : '确认加入'}
            </button>
            <button type="button" disabled={working} onClick={onCancel}>
              暂不加入
            </button>
          </div>
        </div>
      ) : (
        <>
          <div className={ownershipStyles.attachLead}>
            <strong>这份报名尚未归档</strong>
            <p>加入后，它会出现在你当前的“我的赛事”中。</p>
          </div>
          <button type="button" className={styles.claimButton} onClick={onArm}>
            <span className={styles.keyMark} aria-hidden="true">
              +1
            </span>
            <span>加入当前通行证</span>
            <span aria-hidden="true">↗</span>
          </button>
        </>
      )}

      <div className={styles.actionStatus} aria-live="polite">
        {working ? <p>正在把报名加入当前通行证。</p> : null}
        {attachState === 'error' ? (
          <p className={styles.error} role="alert">
            {ATTACH_ERROR}
          </p>
        ) : null}
      </div>
      <div className={ownershipStyles.switchNotice}>
        <p>公用设备，或不确定当前是谁的通行证？请先退出，再由报名持有人登录。</p>
        <button type="button" disabled={switchState === 'working'} onClick={onSwitch}>
          {switchState === 'working' ? '正在退出…' : '退出并更换通行证'}
        </button>
        <div aria-live="polite">
          {switchState === 'error' ? (
            <p className={styles.error} role="alert">
              {SWITCH_ERROR}
            </p>
          ) : null}
        </div>
      </div>
    </div>
  )
}

export function CurrentOwnerAction() {
  return (
    <div className={styles.complete} role="status">
      <span className={styles.stamp} aria-hidden="true">
        已归档
      </span>
      <div>
        <strong>已在你的赛事通行证中</strong>
        <p>这份报名已经出现在“我的赛事”；原管理链接继续用于修改。</p>
      </div>
      {/* The private archive must not enter the client route cache. */}
      <a href="/me">前往我的赛事 ↗</a>
    </div>
  )
}

export function OtherOwnerAction({
  conflict,
  hasActiveParticipant,
  loginHref,
}: {
  conflict: boolean
  hasActiveParticipant: boolean
  loginHref: string
}) {
  const canConfirmByLogin = !hasActiveParticipant && !conflict
  return (
    <div className={`${styles.complete} ${ownershipStyles.otherOwner}`} role="status">
      <span className={`${styles.stamp} ${ownershipStyles.neutralStamp}`} aria-hidden="true">
        已有归属
      </span>
      <div>
        <strong>
          {conflict
            ? '这份报名刚刚完成归属'
            : canConfirmByLogin
              ? '这份报名已绑定赛事通行证'
              : '这份报名已有归属'}
        </strong>
        <p>
          {canConfirmByLogin
            ? '登录后可以确认它是否在你的“我的赛事”中。'
            : `${conflict ? '它未加入当前通行证，且' : '它'}不能重复加入。原管理链接仍可照常使用。`}
        </p>
      </div>
      {canConfirmByLogin ? (
        <Link className={ownershipStyles.loginLink} href={loginHref}>
          登录并确认 <span aria-hidden="true">↗</span>
        </Link>
      ) : (
        <small>如果归属有误，请联系赛事负责人处理。</small>
      )}
    </div>
  )
}

export function OwnershipNotes({ state }: { state: ParticipantEntryOwnershipState }) {
  return (
    <div className={styles.notes} id="passkey-claim-notes">
      <p>
        <strong>{state === 'anonymous-unclaimed' ? '设备本地验证' : '报名归属'}</strong>
        {state === 'anonymous-unclaimed'
          ? '设备负责保护通行密钥；本站不接收你的面容或指纹数据。'
          : '一份报名只能归入一份赛事通行证，避免私人资料重复暴露。'}
      </p>
      <p>
        <strong>管理链接保留</strong>
        “我的赛事”用于只读查看；修改仍需使用这条原管理链接。
      </p>
    </div>
  )
}
