import { useState, useEffect } from 'react';
import { Icon } from './Icon';

interface SearchBarProps {
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  debounceMs?: number;
  className?: string;
}

export function SearchBar({ 
  value, 
  onChange, 
  placeholder = 'Search...',
  debounceMs = 300,
  className = ''
}: SearchBarProps) {
  const [localValue, setLocalValue] = useState(value);
  
  useEffect(() => {
    setLocalValue(value);
  }, [value]);
  
  useEffect(() => {
    const timer = setTimeout(() => {
      onChange(localValue);
    }, debounceMs);
    
    return () => clearTimeout(timer);
  }, [localValue, onChange, debounceMs]);
  
  return (
    <div className={`relative ${className}`}>
      <div className="pointer-events-none absolute inset-y-0 left-0 flex items-center pl-3">
        <Icon name="search" className="h-5 w-5 text-gray-400" />
      </div>
      <input
        type="search"
        value={localValue}
        onChange={(e) => setLocalValue(e.target.value)}
        className="block w-full rounded-lg border border-gray-300 bg-white py-2 pl-10 pr-3 text-sm placeholder-gray-500 focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
        placeholder={placeholder}
      />
      {localValue && (
        <button
          type="button"
          onClick={() => setLocalValue('')}
          className="absolute inset-y-0 right-0 flex items-center pr-3"
        >
          <Icon name="close" className="h-4 w-4 text-gray-400 hover:text-gray-600" />
        </button>
      )}
    </div>
  );
}
