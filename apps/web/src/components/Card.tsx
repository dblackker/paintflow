import { ReactNode, HTMLAttributes } from 'react';

interface CardProps extends HTMLAttributes<HTMLDivElement> {
  children: ReactNode;
  padding?: 'none' | 'sm' | 'md' | 'lg';
  hoverable?: boolean;
  selected?: boolean;
}

export function Card({ 
  children, 
  padding = 'md', 
  hoverable = false,
  selected = false,
  className = '',
  ...props 
}: CardProps) {
  const paddings = {
    none: '',
    sm: 'p-4',
    md: 'p-6',
    lg: 'p-8',
  };
  
  const hoverStyles = hoverable 
    ? 'hover:border-gray-300 hover:shadow-md cursor-pointer transition-all' 
    : '';
  
  const selectedStyles = selected
    ? 'ring-2 ring-blue-500 border-blue-500'
    : '';
  
  return (
    <div
      className={`bg-white rounded-lg border border-gray-200 shadow-sm ${paddings[padding]} ${hoverStyles} ${selectedStyles} ${className}`}
      {...props}
    >
      {children}
    </div>
  );
}

interface CardHeaderProps {
  children?: ReactNode;
  className?: string;
  title?: ReactNode;
  description?: ReactNode;
}

export function CardHeader({ children, className = '', title, description }: CardHeaderProps) {
  return (
    <div className={`mb-4 ${className}`}>
      {title && <CardTitle>{title}</CardTitle>}
      {description && <CardDescription>{description}</CardDescription>}
      {children}
    </div>
  );
}

interface CardTitleProps {
  children: ReactNode;
  className?: string;
}

export function CardTitle({ children, className = '' }: CardTitleProps) {
  return (
    <h3 className={`pf-section-title ${className}`}>
      {children}
    </h3>
  );
}

interface CardDescriptionProps {
  children: ReactNode;
  className?: string;
}

export function CardDescription({ children, className = '' }: CardDescriptionProps) {
  return (
    <p className={`pf-copy mt-1 ${className}`}>
      {children}
    </p>
  );
}

interface CardContentProps {
  children: ReactNode;
  className?: string;
}

export function CardContent({ children, className = '' }: CardContentProps) {
  return (
    <div className={className}>
      {children}
    </div>
  );
}

interface CardFooterProps {
  children: ReactNode;
  className?: string;
}

export function CardFooter({ children, className = '' }: CardFooterProps) {
  return (
    <div className={`mt-4 pt-4 border-t border-gray-200 ${className}`}>
      {children}
    </div>
  );
}
