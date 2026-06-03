import { InputHTMLAttributes, ReactNode, SelectHTMLAttributes, TextareaHTMLAttributes, forwardRef, useId, useState } from 'react';
import { Icon } from './Icon';

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

  return (
    <div className="mb-1 flex items-center gap-1.5">
      <label htmlFor={htmlFor} className="block text-sm font-medium text-gray-700">
        {label}
      </label>
      {help && (
        <span
          className="group relative inline-flex"
          onBlur={() => {
            window.setTimeout(() => setOpen(false), 120);
          }}
        >
          <button
            type="button"
            className="btn-icon h-5 w-5 text-gray-500"
            aria-label={`Explain ${label}`}
            aria-expanded={open}
            aria-describedby={tooltipId}
            onClick={() => setOpen((current) => !current)}
          >
            <Icon name="info" className="h-3.5 w-3.5" />
          </button>
          <span
            id={tooltipId}
            role="tooltip"
            className={`pointer-events-none absolute left-1/2 top-full z-30 mt-1 w-72 max-w-[calc(100vw-2rem)] -translate-x-1/2 rounded-lg border border-gray-200 bg-white p-3 text-xs font-normal leading-5 text-gray-700 shadow-lg group-hover:block group-focus-within:block sm:left-0 sm:translate-x-0 ${open ? 'block' : 'hidden'}`}
          >
            {help}
          </span>
        </span>
      )}
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
          className={`block w-full rounded-lg border px-3.5 py-2.5 shadow-sm focus:ring-2 focus:ring-offset-0 sm:text-sm ${
            error
              ? 'border-red-300 text-red-900 placeholder-red-300 focus:border-red-500 focus:ring-red-500'
              : 'border-gray-300 focus:border-blue-500 focus:ring-blue-500'
          } ${className}`}
          {...props}
        />
        {error && (
          <p className="mt-1 text-sm text-red-600">{error}</p>
        )}
        {helperText && !error && (
          <p className="mt-1 text-sm text-gray-500">{helperText}</p>
        )}
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
          className={`block w-full rounded-lg border px-3.5 py-2.5 shadow-sm focus:ring-2 focus:ring-offset-0 sm:text-sm ${
            error
              ? 'border-red-300 text-red-900 placeholder-red-300 focus:border-red-500 focus:ring-red-500'
              : 'border-gray-300 focus:border-blue-500 focus:ring-blue-500'
          } ${className}`}
          {...props}
        />
        {error && (
          <p className="mt-1 text-sm text-red-600">{error}</p>
        )}
        {helperText && !error && (
          <p className="mt-1 text-sm text-gray-500">{helperText}</p>
        )}
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
          className={`block w-full rounded-lg border px-3.5 py-2.5 shadow-sm focus:ring-2 focus:ring-offset-0 sm:text-sm ${
            error
              ? 'border-red-300 text-red-900 focus:border-red-500 focus:ring-red-500'
              : 'border-gray-300 focus:border-blue-500 focus:ring-blue-500'
          } ${className}`}
          {...props}
        >
          {options?.map((option) => (
            <option key={option.value} value={option.value}>
              {option.label}
            </option>
          ))}
          {props.children}
        </select>
        {error && (
          <p className="mt-1 text-sm text-red-600">{error}</p>
        )}
        {helperText && !error && (
          <p className="mt-1 text-sm text-gray-500">{helperText}</p>
        )}
      </div>
    );
  }
);

Select.displayName = 'Select';
