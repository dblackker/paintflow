import { InputHTMLAttributes, ReactNode, SelectHTMLAttributes, TextareaHTMLAttributes, forwardRef, useId, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { Icon } from './Icon';
import '../styles/mobile.css';

interface InputProps extends InputHTMLAttributes<HTMLInputElement> {
  label?: string;
  labelHelp?: ReactNode;
  error?: string;
  helperText?: string;
}

function useStableFieldId(prefix: string, explicitId?: string) {
  const reactId = useId().replace(/:/g, '');
  return explicitId || `${prefix}-${reactId}`;
}

function FieldLabel({ htmlFor, label, help }: { htmlFor: string; label: string; help?: ReactNode }) {
  const tooltipId = useStableFieldId('field-help');
  const [open, setOpen] = useState(false);
  const buttonRef = useRef<HTMLButtonElement>(null);
  const popoverRef = useRef<HTMLDivElement>(null);
  const [position, setPosition] = useState({ top: 0, left: 0, width: 288, maxHeight: 320 });

  useLayoutEffect(() => {
    if (!open) return;
    const update = () => {
      const trigger = buttonRef.current;
      const popover = popoverRef.current;
      if (!trigger || !popover) return;
      const viewport = window.visualViewport;
      const viewportLeft = viewport?.offsetLeft || 0;
      const viewportTop = viewport?.offsetTop || 0;
      const viewportWidth = viewport?.width || window.innerWidth;
      const viewportHeight = viewport?.height || window.innerHeight;
      const rect = trigger.getBoundingClientRect();
      const width = Math.min(288, viewportWidth - 32);
      const maxHeight = Math.max(48, viewportHeight - 32);
      const height = Math.min(popover.scrollHeight, maxHeight);
      const below = rect.bottom + 8;
      const top = below + height <= viewportTop + viewportHeight - 16
        ? below
        : Math.max(viewportTop + 16, rect.top - height - 8);
      const left = Math.max(viewportLeft + 16, Math.min(rect.left, viewportLeft + viewportWidth - width - 16));
      setPosition({ top, left, width, maxHeight });
    };
    const dismiss = (event: PointerEvent) => {
      if (event.target instanceof Node && !buttonRef.current?.contains(event.target) && !popoverRef.current?.contains(event.target)) setOpen(false);
    };
    const escape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault();
        event.stopPropagation();
        setOpen(false);
        buttonRef.current?.focus();
      }
    };
    update();
    document.addEventListener('pointerdown', dismiss, true);
    document.addEventListener('keydown', escape, true);
    window.addEventListener('resize', update);
    window.addEventListener('scroll', update, true);
    window.visualViewport?.addEventListener('resize', update);
    return () => {
      document.removeEventListener('pointerdown', dismiss, true);
      document.removeEventListener('keydown', escape, true);
      window.removeEventListener('resize', update);
      window.removeEventListener('scroll', update, true);
      window.visualViewport?.removeEventListener('resize', update);
    };
  }, [open]);

  return (
    <div className="pf-field-label-row">
      <label htmlFor={htmlFor} className="pf-field-label">
        {label}
      </label>
      {help && (
        <>
          <button
            ref={buttonRef}
            type="button"
            className="btn-icon pf-field-help-button"
            aria-label={`Explain ${label}`}
            aria-expanded={open}
            aria-controls={open ? tooltipId : undefined}
            aria-describedby={open ? tooltipId : undefined}
            onClick={() => setOpen((current) => !current)}
          >
            <Icon name="info" />
          </button>
          {open && createPortal(<div
            ref={popoverRef}
            id={tooltipId}
            role="tooltip"
            className="pf-field-help-popover"
            style={position}
          >
            {help}
          </div>, buttonRef.current?.closest('[role="dialog"]') || document.body)}
        </>
      )}
    </div>
  );
}

function fieldDescriptions(current: string | undefined, helperId?: string, errorId?: string) {
  const ids = [...(current?.split(/\s+/) || []), helperId, errorId].filter((id): id is string => Boolean(id));
  return Array.from(new Set(ids)).join(' ') || undefined;
}

function FieldMessages({ inputId, error, helperText }: { inputId: string; error?: string; helperText?: string }) {
  return (
    <div className="pf-field-messages">
      {error && <p id={`${inputId}-field-error`} className="pf-field-error" role="alert">{error}</p>}
      {helperText && !error && <p id={`${inputId}-helper`} className="form-helper mt-1">{helperText}</p>}
    </div>
  );
}

export const Input = forwardRef<HTMLInputElement, InputProps>(
  ({ label, labelHelp, error, helperText, className = '', id, ...props }, ref) => {
    const inputId = useStableFieldId('input', id);
    
    return (
      <div className="w-full">
        {label && <FieldLabel htmlFor={inputId} label={label} help={labelHelp} />}
        <input
          ref={ref}
          id={inputId}
          {...props}
          className={`pf-input-control ${error ? 'pf-field-invalid' : ''} ${className}`}
          aria-invalid={error ? true : props['aria-invalid']}
          data-pf-managed-error-id={error ? `${inputId}-field-error` : undefined}
          aria-describedby={fieldDescriptions(props['aria-describedby'], helperText && !error ? `${inputId}-helper` : undefined, error ? `${inputId}-field-error` : undefined)}
        />
        <FieldMessages inputId={inputId} error={error} helperText={helperText} />
      </div>
    );
  }
);

Input.displayName = 'Input';

interface TextareaProps extends TextareaHTMLAttributes<HTMLTextAreaElement> {
  label?: string;
  labelHelp?: ReactNode;
  error?: string;
  helperText?: string;
}

export const Textarea = forwardRef<HTMLTextAreaElement, TextareaProps>(
  ({ label, labelHelp, error, helperText, className = '', id, ...props }, ref) => {
    const inputId = useStableFieldId('textarea', id);
    
    return (
      <div className="w-full">
        {label && <FieldLabel htmlFor={inputId} label={label} help={labelHelp} />}
        <textarea
          ref={ref}
          id={inputId}
          {...props}
          className={`pf-input-control pf-input-control--multiline ${error ? 'pf-field-invalid' : ''} ${className}`}
          aria-invalid={error ? true : props['aria-invalid']}
          data-pf-managed-error-id={error ? `${inputId}-field-error` : undefined}
          aria-describedby={fieldDescriptions(props['aria-describedby'], helperText && !error ? `${inputId}-helper` : undefined, error ? `${inputId}-field-error` : undefined)}
        />
        <FieldMessages inputId={inputId} error={error} helperText={helperText} />
      </div>
    );
  }
);

Textarea.displayName = 'Textarea';

interface SelectProps extends SelectHTMLAttributes<HTMLSelectElement> {
  label?: string;
  labelHelp?: ReactNode;
  error?: string;
  helperText?: string;
  options?: Array<{ value: string; label: string }>;
}

export const Select = forwardRef<HTMLSelectElement, SelectProps>(
  ({ label, labelHelp, error, helperText, options, className = '', id, ...props }, ref) => {
    const inputId = useStableFieldId('select', id);
    
    return (
      <div className="w-full">
        {label && <FieldLabel htmlFor={inputId} label={label} help={labelHelp} />}
        <select
          ref={ref}
          id={inputId}
          {...props}
          className={`pf-input-control ${error ? 'pf-field-invalid' : ''} ${className}`}
          aria-invalid={error ? true : props['aria-invalid']}
          data-pf-managed-error-id={error ? `${inputId}-field-error` : undefined}
          aria-describedby={fieldDescriptions(props['aria-describedby'], helperText && !error ? `${inputId}-helper` : undefined, error ? `${inputId}-field-error` : undefined)}
        >
          {options?.map((option) => (
            <option key={option.value} value={option.value}>
              {option.label}
            </option>
          ))}
          {props.children}
        </select>
        <FieldMessages inputId={inputId} error={error} helperText={helperText} />
      </div>
    );
  }
);

Select.displayName = 'Select';
