import { Icon } from './Icon';

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
          <Icon name="map-pin" className="h-4 w-4" />
        </a>
      )}
    </span>
  );
}
