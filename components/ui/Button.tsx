import Link, { type LinkProps } from 'next/link'
import type { AnchorHTMLAttributes, ButtonHTMLAttributes } from 'react'
import styles from './Button.module.css'

type ButtonVariant = 'primary' | 'ghost' | 'danger'
type ButtonSize = 'md' | 'mini'

interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant
  size?: ButtonSize
}

type ButtonLinkProps = LinkProps &
  Omit<AnchorHTMLAttributes<HTMLAnchorElement>, keyof LinkProps> & {
    variant?: ButtonVariant
    size?: ButtonSize
  }

function buttonClasses(variant: ButtonVariant, size: ButtonSize, className?: string) {
  return [styles.button, styles[variant], size === 'mini' ? styles.mini : '', className]
    .filter(Boolean)
    .join(' ')
}

export function Button({ variant = 'ghost', size = 'md', className, ...props }: ButtonProps) {
  const classes = buttonClasses(variant, size, className)
  return <button className={classes} {...props} />
}

export function ButtonLink({
  variant = 'ghost',
  size = 'md',
  className,
  ...props
}: ButtonLinkProps) {
  return <Link className={buttonClasses(variant, size, className)} {...props} />
}
