import { useEffect, useRef, useState } from 'react';

import { cleanZip, isValidUsZip, lookupUsZip, type ZipLookupResult } from '@/lib/locations';
import { isGooglePlacesConfigured, loadGooglePlaces, parseGoogleAddress } from '@/lib/googlePlaces';
import { Button } from './Button';
import { Input } from './Input';

export interface AddressValue {
  streetAddress: string;
  city: string;
  state: string;
  postalCode: string;
}

interface ZipCodeInputProps {
  value: string;
  onChange: (value: string) => void;
  onResolved?: (result: ZipLookupResult) => void;
  label?: string;
  placeholder?: string;
  required?: boolean;
  helperText?: string;
  className?: string;
}

export function ZipCodeInput({
  value,
  onChange,
  onResolved,
  label = 'ZIP',
  placeholder = '98402',
  required,
  helperText,
  className,
}: ZipCodeInputProps) {
  const [lookupState, setLookupState] = useState<'idle' | 'checking' | 'valid' | 'invalid'>('idle');
  const [locationLabel, setLocationLabel] = useState('');

  async function validate(zipValue: string) {
    const zipCode = cleanZip(zipValue);
    if (!zipCode) {
      setLookupState('idle');
      setLocationLabel('');
      return null;
    }

    if (!isValidUsZip(zipCode)) {
      setLookupState('invalid');
      setLocationLabel('');
      return null;
    }

    setLookupState('checking');
    const result = await lookupUsZip(zipCode);
    if (!result) {
      setLookupState('invalid');
      setLocationLabel('');
      return null;
    }

    setLookupState('valid');
    setLocationLabel(`${result.city}, ${result.stateAbbr}`);
    onResolved?.(result);
    return result;
  }

  const error = lookupState === 'invalid' ? 'Enter a valid 5-digit US ZIP code.' : undefined;
  const resolvedHelper = lookupState === 'checking'
    ? 'Checking ZIP...'
    : lookupState === 'valid' && locationLabel
      ? `Matched ${locationLabel}.`
      : helperText;

  return (
    <Input
      label={label}
      required={required}
      type="text"
      inputMode="numeric"
      autoComplete="postal-code"
      maxLength={5}
      placeholder={placeholder}
      value={value}
      error={error}
      helperText={resolvedHelper}
      className={className}
      onChange={(event) => {
        onChange(cleanZip(event.target.value));
        setLookupState('idle');
        setLocationLabel('');
      }}
      onBlur={(event) => {
        void validate(event.target.value);
      }}
    />
  );
}

interface AddressFieldsProps {
  value: AddressValue;
  onChange: (value: AddressValue) => void;
  streetLabel?: string;
  required?: boolean;
  className?: string;
}

export function AddressFields({ value, onChange, streetLabel = 'Street address', required, className }: AddressFieldsProps) {
  const streetInputRef = useRef<HTMLInputElement | null>(null);
  const latestRef = useRef({ value, onChange });
  const [placesReady, setPlacesReady] = useState(false);
  const [placesUnavailable, setPlacesUnavailable] = useState(false);

  useEffect(() => {
    latestRef.current = { value, onChange };
  }, [onChange, value]);

  useEffect(() => {
    if (!isGooglePlacesConfigured()) return;

    let cancelled = false;
    loadGooglePlaces()
      .then(() => {
        if (!cancelled) setPlacesReady(true);
      })
      .catch(() => {
        if (!cancelled) setPlacesUnavailable(true);
      });

    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    if (!placesReady || !streetInputRef.current || !window.google?.maps?.places?.Autocomplete) return;

    const autocomplete = new window.google.maps.places.Autocomplete(streetInputRef.current, {
      componentRestrictions: { country: 'us' },
      fields: ['address_components'],
      types: ['address'],
    });
    autocomplete.setFields?.(['address_components']);
    const listener = autocomplete.addListener('place_changed', () => {
      const parsed = parseGoogleAddress(autocomplete.getPlace());
      if (!parsed) return;
      const current = latestRef.current.value;
      latestRef.current.onChange({
        streetAddress: parsed.streetAddress || current.streetAddress,
        city: parsed.city || current.city,
        state: parsed.state || current.state,
        postalCode: cleanZip(parsed.postalCode) || current.postalCode,
      });
    });

    return () => {
      listener.remove();
    };
  }, [placesReady]);

  return (
    <div className={className || 'grid gap-3'}>
      <Input
        ref={streetInputRef}
        label={streetLabel}
        required={required}
        autoComplete="street-address"
        placeholder="123 Main St"
        enterKeyHint="next"
        value={value.streetAddress}
        helperText={placesReady ? 'Start typing and choose a verified Google address.' : placesUnavailable ? 'Google address suggestions are unavailable. You can still enter the address manually.' : undefined}
        onChange={(event) => onChange({ ...value, streetAddress: event.target.value })}
      />
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-[1fr_96px_120px]">
        <Input
          label="City"
          required={required}
          autoComplete="address-level2"
          enterKeyHint="next"
          value={value.city}
          onChange={(event) => onChange({ ...value, city: event.target.value })}
        />
        <Input
          label="State"
          required={required}
          autoComplete="address-level1"
          maxLength={2}
          enterKeyHint="next"
          value={value.state}
          onChange={(event) => onChange({ ...value, state: event.target.value.toUpperCase().slice(0, 2) })}
        />
        <ZipCodeInput
          required={required}
          value={value.postalCode}
          onChange={(postalCode) => onChange({ ...value, postalCode })}
          onResolved={(result) => {
            onChange({
              ...value,
              postalCode: result.zipCode,
              city: value.city || result.city,
              state: value.state || result.stateAbbr,
            });
          }}
        />
      </div>
    </div>
  );
}

interface ServiceAreaZipInputProps {
  value: string;
  onChange: (value: string) => void;
  onAdd: (result: ZipLookupResult) => void;
  existingZips: string[];
}

export function ServiceAreaZipInput({ value, onChange, onAdd, existingZips }: ServiceAreaZipInputProps) {
  const [isChecking, setIsChecking] = useState(false);
  const [message, setMessage] = useState<{ tone: 'error' | 'info'; text: string } | null>(null);

  async function addZip() {
    const zipCode = cleanZip(value);
    if (!isValidUsZip(zipCode)) {
      setMessage({ tone: 'error', text: 'Enter one valid 5-digit ZIP code.' });
      return;
    }
    if (existingZips.includes(zipCode)) {
      setMessage({ tone: 'info', text: `${zipCode} is already in your service area.` });
      return;
    }

    setIsChecking(true);
    setMessage(null);
    const result = await lookupUsZip(zipCode);
    setIsChecking(false);
    if (!result) {
      setMessage({ tone: 'error', text: 'That ZIP code could not be verified.' });
      return;
    }

    onAdd(result);
    onChange('');
    setMessage({ tone: 'info', text: `Added ${result.zipCode} - ${result.city}, ${result.stateAbbr}.` });
  }

  return (
    <div className="grid gap-2">
      <div className="flex flex-col gap-2 sm:flex-row sm:items-end">
        <div className="min-w-0 flex-1">
          <ZipCodeInput
            label="Add service ZIP"
            value={value}
            onChange={onChange}
            helperText="Add one ZIP at a time. Each ZIP is checked before it is saved."
          />
        </div>
        <Button type="button" className="sm:mb-[1.625rem]" isLoading={isChecking} onClick={addZip}>
          Add ZIP
        </Button>
      </div>
      {message && (
        <p className={message.tone === 'error' ? 'pf-field-error' : 'form-helper'}>
          {message.text}
        </p>
      )}
    </div>
  );
}
