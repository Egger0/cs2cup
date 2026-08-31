import type { ButtonHTMLAttributes } from 'react'
import styles from './Button.module.css'

type ButtonVariant = 'primary' | 'ghost' | 'danger'
type ButtonSize = 'md' | 'mini'

interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant
  size?: ButtonSize
}

export function Button({ variant = 'ghost', size = 'md', className, ...props }: ButtonProps) {
  const classes = [styles.button, styles[variant], size === 'mini' ? styles.mini : '', className]
    .filter(Boolean)
    .join(' ')
  return <button className={classes} {...props} />
}
