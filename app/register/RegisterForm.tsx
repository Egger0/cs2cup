'use client'

import Link from 'next/link'
import { useEffect, useRef, useState, type FormEvent } from 'react'
import { PasswordInput } from '@/components/ui/PasswordInput'
import { registrationAuthHref } from '@/lib/registration-navigation'
import formStyles from '../login/credential-form.module.css'
import styles from './register.module.css'

const SETUP_FAILURE = '注册暂时不可用，请稍后重试。'

const FAILURE_COPY: Record<string, string> = {
  request: '这次提交未完成，请刷新页面后重试。',
  screening_unavailable: SETUP_FAILURE,
  setup: SETUP_FAILURE,
  signed_in: '当前浏览器已有登录账号，请先退出后再创建新账号。',
  username_unavailable: '这个用户名不可用，请换一个再试。',
  invalid_format: '用户名需为 3–32 位小写字母、数字、点、短横线或下划线。',
  reserved: '这个用户名不可用，请换一个再试。',
}

function encodedForm(form: HTMLFormElement) {
  const encoded = new URLSearchParams()
  for (const [key, value] of new FormData(form)) {
    if (typeof value === 'string') encoded.append(key, value)
  }
  return encoded
}

export function RegisterForm({
  initialError,
  tournamentSlug,
}: {
  initialError?: string
  tournamentSlug?: string | null
}) {
  const endpoint = tournamentSlug
    ? `/api/auth/register?tournamentSlug=${encodeURIComponent(tournamentSlug)}`
    : '/api/auth/register'
  const [working, setWorking] = useState(false)
  const formRef = useRef<HTMLFormElement>(null)
  const [uncertain, setUncertain] = useState(false)
  const [error, setError] = useState(
    initialError
      ? (FAILURE_COPY[initialError] ?? '请检查账号信息和成员资料后重试。本次未创建账号。')
      : '',
  )
  const [errorField, setErrorField] = useState('')

  useEffect(() => {
    if (working || !errorField) return
    const field = formRef.current?.elements.namedItem(errorField)
    if (field instanceof HTMLElement) field.focus()
  }, [errorField, working])

  function showUncertainResult() {
    setUncertain(true)
    setError('暂时没能确认创建结果。请先尝试登录；如果无法登录，再回来重试。')
  }

  function clearChangedError(event: FormEvent<HTMLFormElement>) {
    if (!(event.target instanceof HTMLInputElement || event.target instanceof HTMLTextAreaElement))
      return
    const name = event.target.name
    const confirmationChanged =
      errorField === 'passwordConfirmation' &&
      (name === 'password' || name === 'passwordConfirmation')
    if (name === errorField || confirmationChanged) {
      setError('')
      setErrorField('')
    }
  }

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (working) return
    setUncertain(false)
    const form = event.currentTarget
    const data = new FormData(form)
    if (data.get('password') !== data.get('passwordConfirmation')) {
      setError('两次输入的密码不一致。')
      setErrorField('passwordConfirmation')
      return
    }
    setWorking(true)
    setError('')
    setErrorField('')
    try {
      const response = await fetch(endpoint, {
        method: 'POST',
        body: encodedForm(form),
        credentials: 'same-origin',
        headers: {
          Accept: 'application/json',
          'Content-Type': 'application/x-www-form-urlencoded',
        },
      })
      const payload = (await response.json().catch(() => null)) as {
        error?: string
        field?: string
        redirectTo?: string
      } | null
      if (!response.ok) {
        setError(payload?.error ?? SETUP_FAILURE)
        setErrorField(payload?.field ?? '')
        return
      }
      if (!payload?.redirectTo) {
        showUncertainResult()
        return
      }
      window.location.assign(payload.redirectTo)
    } catch {
      showUncertainResult()
    } finally {
      setWorking(false)
    }
  }

  return (
    <form
      ref={formRef}
      className={`${formStyles.passwordForm} ${styles.form}`}
      action={endpoint}
      method="post"
      onSubmit={submit}
      onChange={clearChangedError}
      aria-busy={working}
    >
      <h3 className={styles.sectionTitle}>账号信息</h3>
      <div className={styles.nameGrid}>
        <label className={formStyles.field}>
          <span>用户名</span>
          <input
            name="username"
            aria-label="用户名"
            aria-describedby={
              errorField === 'username' ? 'username-guidance signup-error' : 'username-guidance'
            }
            autoComplete="username"
            autoCapitalize="none"
            enterKeyHint="next"
            maxLength={32}
            spellCheck={false}
            aria-invalid={errorField === 'username'}
            disabled={working}
            required
          />
          <small id="username-guidance">3–32 位小写字母、数字、点、短横线或下划线</small>
        </label>
        <label className={formStyles.field}>
          <span>
            显示名称 <span className={styles.optional}>选填</span>
          </span>
          <input
            name="displayName"
            aria-label="显示名称"
            aria-describedby={
              errorField === 'displayName'
                ? 'display-name-guidance signup-error'
                : 'display-name-guidance'
            }
            autoComplete="nickname"
            maxLength={80}
            aria-invalid={errorField === 'displayName'}
            disabled={working}
          />
          <small id="display-name-guidance">留空时使用用户名，可以稍后修改</small>
        </label>
      </div>
      <label className={formStyles.field}>
        <span>密码</span>
        <PasswordInput
          name="password"
          aria-label="密码"
          autoComplete="new-password"
          minLength={6}
          maxLength={1024}
          aria-invalid={errorField === 'password'}
          aria-describedby={
            errorField === 'password' ? 'password-guidance signup-error' : 'password-guidance'
          }
          disabled={working}
          required
        />
        <small id="password-guidance">
          至少 6 个字符，支持中文和空格。建议用几个不相关的词组合，不要使用用户名或昵称。
        </small>
      </label>
      <label className={formStyles.field}>
        <span>确认密码</span>
        <PasswordInput
          name="passwordConfirmation"
          autoComplete="new-password"
          minLength={6}
          maxLength={1024}
          aria-invalid={errorField === 'passwordConfirmation'}
          aria-describedby={errorField === 'passwordConfirmation' ? 'signup-error' : undefined}
          disabled={working}
          required
        />
      </label>
      <h3 className={styles.sectionTitle}>成员申请资料</h3>
      <p className={styles.after}>资料会随账号一起提交审核，通过后即可获得正式成员资格。</p>
      <label className={formStyles.field}>
        <span>身份与参与依据</span>
        <input
          name="identityClaim"
          minLength={3}
          maxLength={160}
          placeholder="例如：学号、院系或与社团的关系"
          aria-invalid={errorField === 'identityClaim'}
          aria-describedby={errorField === 'identityClaim' ? 'signup-error' : undefined}
          disabled={working}
          required
        />
      </label>
      <label className={formStyles.field}>
        <span>联系信息</span>
        <input
          name="contact"
          minLength={3}
          maxLength={160}
          placeholder="例如：QQ 号或其他便于审核联系的方式"
          aria-invalid={errorField === 'contact'}
          aria-describedby={
            errorField === 'contact' ? 'contact-guidance signup-error' : 'contact-guidance'
          }
          disabled={working}
          required
        />
        <small id="contact-guidance">仅用于审核联系，不会自动绑定 QQ 或成为账号恢复方式。</small>
      </label>
      <label className={formStyles.field}>
        <span>补充说明（选填）</span>
        <textarea
          className={styles.reason}
          name="applicationReason"
          maxLength={500}
          rows={3}
          aria-invalid={errorField === 'applicationReason'}
          aria-describedby={errorField === 'applicationReason' ? 'signup-error' : undefined}
          disabled={working}
        />
      </label>
      {error ? (
        <p
          id="signup-error"
          className={errorField ? formStyles.formError : formStyles.formNotice}
          role="alert"
        >
          {error}
          {uncertain ? (
            <Link href={registrationAuthHref('login', tournamentSlug)} className={styles.tryLogin}>
              尝试登录 →
            </Link>
          ) : null}
        </p>
      ) : null}
      <button className={formStyles.passwordButton} type="submit" disabled={working}>
        <span>{working ? '正在创建并提交…' : '创建账号并提交申请'}</span>
        <span aria-hidden="true">↗</span>
      </button>
      <p className={styles.after}>
        完成后自动登录，成员申请进入审核队列；赛事报名资料可以稍后填写。
      </p>
    </form>
  )
}
