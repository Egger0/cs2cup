import type { InputHTMLAttributes, TextareaHTMLAttributes } from 'react'
import styles from './Field.module.css'

interface FieldShell {
  id: string
  label: string
  required?: boolean
  hint?: string
  error?: string
}

export type FieldProps = FieldShell & InputHTMLAttributes<HTMLInputElement>
export type TextFieldProps = FieldShell & TextareaHTMLAttributes<HTMLTextAreaElement>

function Label({ id, label, required, hint }: FieldShell) {
  return (
    <label className={styles.label} htmlFor={id}>
      {label}
      {required ? <span className={styles.required}>*</span> : null}
      {hint ? <span className={styles.hint}>{hint}</span> : null}
    </label>
  )
}

export function Field({ id, label, required, hint, error, ...props }: FieldProps) {
  return (
    <div className={styles.field}>
      <Label id={id} label={label} required={required} hint={hint} />
      <input
        id={id}
        className={error ? `${styles.control} ${styles.invalid}` : styles.control}
        aria-invalid={error ? true : undefined}
        aria-describedby={error ? `${id}-error` : undefined}
        required={required}
        {...props}
      />
      {error ? (
        <span id={`${id}-error`} className={styles.error}>
          {error}
        </span>
      ) : null}
    </div>
  )
}

export function TextField({ id, label, required, hint, error, ...props }: TextFieldProps) {
  return (
    <div className={styles.field}>
      <Label id={id} label={label} required={required} hint={hint} />
      <textarea
        id={id}
        className={error ? `${styles.control} ${styles.invalid}` : styles.control}
        aria-invalid={error ? true : undefined}
        required={required}
        {...props}
      />
      {error ? <span className={styles.error}>{error}</span> : null}
    </div>
  )
}
