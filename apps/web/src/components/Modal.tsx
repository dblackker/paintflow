import { ReactNode, useEffect } from 'react';
import { Icon } from './Icon';

interface ModalProps {
  isOpen: boolean;
  onClose: () => void;
  title?: string;
  children: ReactNode;
  size?: 'sm' | 'md' | 'lg' | 'xl';
}

export function Modal({ isOpen, onClose, title, children, size = 'md' }: ModalProps) {
  useEffect(() => {
    document.body.classList.toggle('pf-modal-open', isOpen);
    
    return () => {
      document.body.classList.remove('pf-modal-open');
    };
  }, [isOpen]);
  
  useEffect(() => {
    const handleEscape = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    
    if (isOpen) {
      document.addEventListener('keydown', handleEscape);
      return () => document.removeEventListener('keydown', handleEscape);
    }
  }, [isOpen, onClose]);
  
  if (!isOpen) return null;
  
  const sizes = {
    sm: 'max-w-md',
    md: 'max-w-lg',
    lg: 'max-w-2xl',
    xl: 'max-w-4xl',
  };
  
  return (
    <div className="fixed inset-0 z-[200] overflow-y-auto">
      <div className="flex min-h-full items-end justify-center p-0 pt-[calc(4.75rem+env(safe-area-inset-top))] text-center sm:items-center sm:p-4 sm:pt-[calc(4.75rem+env(safe-area-inset-top))]">
        {/* Backdrop */}
        <div 
          className="fixed inset-0 bg-gray-500 bg-opacity-75 transition-opacity"
          onClick={onClose}
        />
        
        {/* Modal */}
        <div className={`pf-modal-panel relative flex max-h-[calc(100dvh-4.75rem-env(safe-area-inset-top)-env(safe-area-inset-bottom))] w-full transform flex-col overflow-hidden rounded-t-2xl bg-white text-left shadow-xl transition-all sm:my-8 sm:w-full sm:rounded-lg ${sizes[size]}`}>
          {/* Header */}
          {title && (
            <div className="flex shrink-0 items-center justify-between border-b border-gray-200 px-4 py-3 sm:px-6 sm:py-4">
              <h3 className="pf-section-title">
                {title}
              </h3>
              <button
                onClick={onClose}
                className="btn-icon"
              >
                <span className="sr-only">Close</span>
                <Icon name="close" className="h-5 w-5" />
              </button>
            </div>
          )}
          
          {/* Content */}
          <div className="overflow-y-auto px-4 py-4 sm:px-6">
            {children}
          </div>
        </div>
      </div>
    </div>
  );
}

interface ModalFooterProps {
  children: ReactNode;
  className?: string;
}

export function ModalFooter({ children, className = '' }: ModalFooterProps) {
  return (
    <div className={`sticky bottom-0 -mx-4 mt-4 flex flex-col gap-2 border-t border-gray-200 bg-white px-4 py-3 pb-[calc(0.75rem+env(safe-area-inset-bottom))] sm:-mx-6 sm:flex-row sm:justify-end sm:px-6 sm:py-4 ${className}`}>
      {children}
    </div>
  );
}
