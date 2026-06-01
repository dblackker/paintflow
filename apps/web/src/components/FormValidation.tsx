import { ReactNode, useEffect } from 'react';

const FIELD_SELECTOR = 'input, select, textarea';
const ERROR_CLASS = 'pf-field-error';
const INVALID_CLASS = 'pf-field-invalid';
const fieldIds = new WeakMap<Element, string>();

function fieldLabel(field: HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement) {
  const explicitLabel = field.labels?.[0]?.textContent?.trim();
  if (explicitLabel) return explicitLabel.replace(/\s+/g, ' ');
  const ariaLabel = field.getAttribute('aria-label')?.trim();
  if (ariaLabel) return ariaLabel;
  const placeholder = field.getAttribute('placeholder')?.trim();
  if (placeholder) return placeholder;
  const name = field.getAttribute('name')?.trim();
  if (name) return name.replace(/[-_]/g, ' ');
  return 'This field';
}

function fieldKey(field: HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement) {
  if (field.id) return field.id;
  const existing = fieldIds.get(field);
  if (existing) return existing;
  const generated = `pf-field-${Math.random().toString(36).slice(2, 10)}`;
  field.id = generated;
  fieldIds.set(field, generated);
  return generated;
}

function validationMessage(field: HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement) {
  const label = fieldLabel(field);
  const validity = field.validity;

  if (validity.valueMissing) {
    return field instanceof HTMLSelectElement ? `Choose ${label.toLowerCase()}.` : `${label} is required.`;
  }
  if (validity.typeMismatch) {
    if (field.getAttribute('type') === 'email') return 'Enter a valid email address.';
    if (field.getAttribute('type') === 'url') return 'Enter a valid URL.';
    return `Enter a valid ${label.toLowerCase()}.`;
  }
  if (validity.rangeUnderflow) return `${label} must be at least ${field.getAttribute('min')}.`;
  if (validity.rangeOverflow) return `${label} must be no more than ${field.getAttribute('max')}.`;
  if (validity.tooShort) return `${label} is too short.`;
  if (validity.tooLong) return `${label} is too long.`;
  if (validity.stepMismatch) return `Enter a valid increment for ${label.toLowerCase()}.`;
  if (validity.patternMismatch) return field.getAttribute('title') || `Enter a valid ${label.toLowerCase()}.`;
  if (validity.badInput) return `Enter a valid ${label.toLowerCase()}.`;
  return field.validationMessage || `Check ${label.toLowerCase()}.`;
}

function describedBy(field: HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement) {
  const id = `${fieldKey(field)}-error`;
  const current = field.getAttribute('aria-describedby') || '';
  return current.split(/\s+/).filter(Boolean).includes(id) ? current : `${current} ${id}`.trim();
}

function clearFieldError(field: HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement) {
  const id = `${fieldKey(field)}-error`;
  field.classList.remove(INVALID_CLASS);
  field.removeAttribute('aria-invalid');
  const current = field.getAttribute('aria-describedby') || '';
  const next = current.split(/\s+/).filter((item) => item && item !== id).join(' ');
  if (next) field.setAttribute('aria-describedby', next);
  else field.removeAttribute('aria-describedby');
  field.parentElement?.querySelector(`#${CSS.escape(id)}`)?.remove();
}

function showFieldError(field: HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement) {
  const id = `${fieldKey(field)}-error`;
  let error = field.parentElement?.querySelector<HTMLParagraphElement>(`#${CSS.escape(id)}`);

  if (!error) {
    error = document.createElement('p');
    error.id = id;
    error.className = ERROR_CLASS;
    error.setAttribute('role', 'alert');
    field.insertAdjacentElement('afterend', error);
  }

  error.textContent = validationMessage(field);
  field.classList.add(INVALID_CLASS);
  field.setAttribute('aria-invalid', 'true');
  field.setAttribute('aria-describedby', describedBy(field));
}

function formFields(form: HTMLFormElement) {
  return Array.from(form.querySelectorAll<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>(FIELD_SELECTOR))
    .filter((field) => !field.disabled && field.type !== 'hidden');
}

export function FormValidationProvider({ children }: { children: ReactNode }) {
  useEffect(() => {
    let lastInvalidForm: HTMLFormElement | null = null;
    let toastFrame = 0;

    function onInvalid(event: Event) {
      const field = event.target;
      if (!(field instanceof HTMLInputElement || field instanceof HTMLSelectElement || field instanceof HTMLTextAreaElement)) return;

      event.preventDefault();
      showFieldError(field);

      const form = field.form;
      if (!form || lastInvalidForm === form) return;
      lastInvalidForm = form;
      window.cancelAnimationFrame(toastFrame);
      toastFrame = window.requestAnimationFrame(() => {
        const firstInvalid = formFields(form).find((candidate) => !candidate.validity.valid);
        firstInvalid?.focus({ preventScroll: true });
        firstInvalid?.scrollIntoView({ behavior: 'smooth', block: 'center' });
        window.showToast?.('Check the highlighted required fields.', 'error');
        window.setTimeout(() => {
          if (lastInvalidForm === form) lastInvalidForm = null;
        }, 250);
      });
    }

    function onInput(event: Event) {
      const field = event.target;
      if (!(field instanceof HTMLInputElement || field instanceof HTMLSelectElement || field instanceof HTMLTextAreaElement)) return;
      if (field.validity.valid) clearFieldError(field);
      else if (field.classList.contains(INVALID_CLASS)) showFieldError(field);
    }

    function onSubmit(event: Event) {
      const form = event.target;
      if (!(form instanceof HTMLFormElement)) return;
      formFields(form).forEach((field) => {
        if (field.validity.valid) clearFieldError(field);
      });
    }

    document.addEventListener('invalid', onInvalid, true);
    document.addEventListener('input', onInput, true);
    document.addEventListener('change', onInput, true);
    document.addEventListener('submit', onSubmit, true);

    return () => {
      window.cancelAnimationFrame(toastFrame);
      document.removeEventListener('invalid', onInvalid, true);
      document.removeEventListener('input', onInput, true);
      document.removeEventListener('change', onInput, true);
      document.removeEventListener('submit', onSubmit, true);
    };
  }, []);

  return children;
}
