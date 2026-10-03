import { AnchorHTMLAttributes, ButtonHTMLAttributes, KeyboardEvent, MouseEvent, ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { Icon } from './Icon';
import '../styles/mobile.css';

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
  onClick,
  onClickCapture,
  onKeyDown,
  ...props
}: ButtonProps) {
  const variants = {
    primary: 'btn-primary',
    secondary: 'btn-secondary',
    ghost: 'btn-text',
    danger: 'btn-primary pf-button-danger',
    success: 'btn-primary pf-button-success',
    dangerSubtle: 'btn-text pf-button-danger-subtle',
  };
  
  const sizes = {
    sm: 'btn-sm',
    md: '',
    lg: 'min-h-12 px-6 text-base',
  };
  
  const width = fullWidth ? 'w-full' : '';
  const blocked = Boolean(disabled || isLoading);
  const classes = `pf-button ${variants[variant]} ${sizes[size]} ${width} ${className}`;
  const content = (
    <>
      <span className={`pf-button-content ${isLoading && !leftIcon ? 'pf-button-content--loading' : ''}`}>
        {leftIcon && <span className="pf-button-icon">{isLoading ? <Icon name="loader" className="h-5 w-5 animate-spin" /> : leftIcon}</span>}
        <span className="pf-button-label">{children}</span>
        {rightIcon && <span className="pf-button-icon">{rightIcon}</span>}
      </span>
      {isLoading && !leftIcon && <Icon name="loader" className="pf-button-loading-icon animate-spin" />}
    </>
  );

  const blockMouseEvent = (event: MouseEvent<HTMLElement>) => {
    event.preventDefault();
    event.stopPropagation();
  };

  if (as === 'a') {
    const anchorProps = props as AnchorHTMLAttributes<HTMLAnchorElement>;
    const events: AnchorHTMLAttributes<HTMLAnchorElement> = {
      onClick: (event) => {
        if (blocked) blockMouseEvent(event);
        else onClick?.(event as unknown as MouseEvent<HTMLButtonElement>);
      },
      onClickCapture: (event) => {
        if (blocked) blockMouseEvent(event);
        else onClickCapture?.(event as unknown as MouseEvent<HTMLButtonElement>);
      },
      onKeyDown: (event) => {
        if (blocked && (event.key === 'Enter' || event.key === ' ')) {
          event.preventDefault();
          event.stopPropagation();
        } else onKeyDown?.(event as unknown as KeyboardEvent<HTMLButtonElement>);
      },
    };
    const linkState = {
      'aria-disabled': blocked || undefined,
      'aria-busy': isLoading || undefined,
      tabIndex: blocked ? -1 : anchorProps.tabIndex,
    };
    const isInternalHref = Boolean(href?.startsWith('/') && !href.startsWith('//') && !target && !download);
    // Removing href also prevents context-menu/open-in-new-tab navigation while blocked.
    if (blocked) {
      return <a {...anchorProps} {...events} {...linkState} role="link" className={classes}>{content}</a>;
    }
    if (isInternalHref && href) {
      return (
        <Link {...anchorProps} {...events} {...linkState} className={classes} to={href}>
          {content}
        </Link>
      );
    }
    return (
      <a {...anchorProps} {...events} {...linkState} className={classes} href={href} target={target} rel={rel} download={download}>
        {content}
      </a>
    );
  }

  if (as === 'span') {
    return (
      <span className={classes} aria-disabled={blocked || undefined} aria-busy={isLoading || undefined}>{content}</span>
    );
  }
  
  return (
    <button
      {...props}
      className={classes}
      disabled={blocked}
      aria-busy={isLoading || undefined}
      onClick={onClick}
      onClickCapture={onClickCapture}
      onKeyDown={onKeyDown}
    >
      {content}
    </button>
  );
}
