import { ReactNode, RefObject, useId, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { Icon } from './Icon';
import { activateDialog, isTopDialog } from './dialogLifecycle';
import '../styles/mobile.css';

interface ModalProps {
  isOpen: boolean;
  onClose: () => void;
  title?: string;
  children: ReactNode;
  size?: 'sm' | 'md' | 'lg' | 'xl';
  description?: string;
  ariaLabel?: string;
  initialFocusRef?: RefObject<HTMLElement>;
  closeOnBackdrop?: boolean;
  closeOnEscape?: boolean;
}

export function Modal({
  isOpen, onClose, title, children, size = 'md', description, ariaLabel,
  initialFocusRef, closeOnBackdrop = true, closeOnEscape = true,
}: ModalProps) {
  const titleId = useId();
  const descriptionId = useId();
  const panelRef = useRef<HTMLDivElement>(null);
  const callbacks = useRef({ onClose, closeOnEscape });
  callbacks.current = { onClose, closeOnEscape };
  const [layer] = useState(() => {
    if (typeof document === 'undefined') return null;
    const element = document.createElement('div');
    element.className = 'pf-dialog-layer';
    return element;
  });

  useLayoutEffect(() => {
    if (!isOpen || !layer || !panelRef.current) return;
    return activateDialog({
      layer,
      panel: panelRef.current,
      initialFocus: initialFocusRef?.current,
      onEscape: () => {
        if (callbacks.current.closeOnEscape) callbacks.current.onClose();
      },
    });
  }, [isOpen, layer, initialFocusRef]);

  if (!isOpen || !layer) return null;

  return createPortal(
    <>
      <div
        className="pf-dialog-backdrop"
        aria-hidden="true"
        onClick={() => {
          if (closeOnBackdrop && isTopDialog(layer)) onClose();
        }}
      />
      <div
        ref={panelRef}
        className={`pf-modal-panel pf-dialog-panel pf-dialog-panel--${size}`}
        role="dialog"
        aria-modal="true"
        aria-labelledby={title ? titleId : undefined}
        aria-label={title ? undefined : (ariaLabel || 'Dialog')}
        aria-describedby={description ? descriptionId : undefined}
        tabIndex={-1}
      >
        <div className="pf-dialog-header">
          <div className="pf-dialog-heading">
            {title && <h2 id={titleId} className="pf-section-title">{title}</h2>}
            {description && <p id={descriptionId} className="form-helper">{description}</p>}
          </div>
          <button type="button" onClick={onClose} className="btn-icon pf-dialog-close" aria-label="Close dialog">
            <Icon name="close" />
          </button>
        </div>
        <div className="pf-dialog-content">{children}</div>
      </div>
    </>,
    layer,
  );
}

interface ModalFooterProps {
  children: ReactNode;
  className?: string;
}

export function ModalFooter({ children, className = '' }: ModalFooterProps) {
  // Keep actions in the form's normal flow: sticky overlays can obscure the last field.
  return <div className={`pf-dialog-footer ${className}`}>{children}</div>;
}
