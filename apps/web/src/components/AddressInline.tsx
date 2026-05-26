interface AddressInlineProps {
  address?: string | null;
  emptyText?: string;
  className?: string;
  showMapAction?: boolean;
}

function mapsUrl(address: string) {
  return `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(address)}`;
}

export function AddressInline({
  address,
  emptyText = 'No jobsite address',
  className = 'pf-copy',
  showMapAction = true,
}: AddressInlineProps) {
  const text = String(address || '').trim();
  if (!text) return <span className={`${className} block truncate`}>{emptyText}</span>;

  return (
    <span className={`pf-address-inline ${className}`}>
      <span className="pf-address-text">{text}</span>
      {showMapAction && (
        <a className="pf-address-map-button" href={mapsUrl(text)} target="_blank" rel="noreferrer" aria-label="Open address in maps" title="Open in maps">
          <svg aria-hidden="true" viewBox="0 0 24 24" fill="none">
            <path d="M12 21s7-5.1 7-11a7 7 0 1 0-14 0c0 5.9 7 11 7 11Z" stroke="currentColor" strokeWidth="1.8" />
            <circle cx="12" cy="10" r="2.4" stroke="currentColor" strokeWidth="1.8" />
          </svg>
        </a>
      )}
    </span>
  );
}
