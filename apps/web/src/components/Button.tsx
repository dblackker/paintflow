import { AnchorHTMLAttributes, ButtonHTMLAttributes, ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { Icon } from './Icon';

type ButtonAs = 'button' | 'a' | 'span';

interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement>, Pick<AnchorHTMLAttributes<HTMLAnchorElement>, 'target' | 'rel' | 'download'> {
  as?: ButtonAs;
  href?: string;
  variant?: 'primary' | 'secondary' | 'ghost' | 'danger' | 'success' | 'dangerSubtle';
  size?: 'sm' | 'md' | 'lg';
  isLoading?: boolean;
  leftIcon?: ReactNode;
  rightIcon?: ReactNode;
  fullWidth?: boolean;
}

export function Button({
  as = 'button',
  href,
  variant = 'primary',
  size = 'md',
  isLoading = false,
  leftIcon,
  rightIcon,
  fullWidth = false,
  target,
  rel,
  download,
  children,
  className = '',
  disabled,
  ...props
}: ButtonProps) {
  const baseStyles = '';

  const variants = {
    primary: 'btn-primary',
    secondary: 'btn-secondary',
    ghost: 'btn-text',
    danger: 'btn-primary bg-[var(--pf-danger)] border-[var(--pf-danger)] hover:bg-[var(--md-sys-color-on-error-container)] hover:border-[var(--md-sys-color-on-error-container)]',
    success: 'btn-primary bg-[var(--pf-success)] border-[var(--pf-success)] hover:bg-green-800 hover:border-green-800',
    dangerSubtle: 'btn-text text-red-700 hover:bg-[var(--md-sys-color-error-container)]',
  };
  
  const sizes = {
    sm: 'btn-sm',
    md: '',
    lg: 'min-h-12 px-6 text-base',
  };
  
  const width = fullWidth ? 'w-full' : '';
  const classes = `${baseStyles} ${variants[variant]} ${sizes[size]} ${width} ${className}`;

  if (as === 'a') {
    const anchorProps = props as AnchorHTMLAttributes<HTMLAnchorElement>;
    const isInternalHref = Boolean(href?.startsWith('/') && !target && !download);
    if (isInternalHref && href) {
      return (
        <Link className={classes} to={href} {...anchorProps}>
          {!isLoading && leftIcon && <span className="mr-2">{leftIcon}</span>}
          {children}
          {!isLoading && rightIcon && <span className="ml-2">{rightIcon}</span>}
        </Link>
      );
    }
    return (
      <a className={classes} href={href} target={target} rel={rel} download={download} {...anchorProps}>
        {!isLoading && leftIcon && <span className="mr-2">{leftIcon}</span>}
        {children}
        {!isLoading && rightIcon && <span className="ml-2">{rightIcon}</span>}
      </a>
    );
  }

  if (as === 'span') {
    return (
      <span className={classes}>
        {!isLoading && leftIcon && <span className="mr-2">{leftIcon}</span>}
        {children}
        {!isLoading && rightIcon && <span className="ml-2">{rightIcon}</span>}
      </span>
    );
  }
  
  return (
    <button
      className={classes}
      disabled={disabled || isLoading}
      {...props}
    >
      {isLoading && (
        <Icon name="loader" className="-ml-1 mr-2 h-4 w-4 animate-spin" />
      )}
      {!isLoading && leftIcon && <span className="mr-2">{leftIcon}</span>}
      {children}
      {!isLoading && rightIcon && <span className="ml-2">{rightIcon}</span>}
    </button>
  );
}
