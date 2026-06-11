const GOOGLE_MAPS_SCRIPT_ID = 'crewmodo-google-maps-places';

let loaderPromise: Promise<void> | null = null;

declare global {
  interface Window {
    google?: {
      maps?: {
        places?: {
          Autocomplete: new (
            input: HTMLInputElement,
            options?: {
              componentRestrictions?: { country: string | string[] };
              fields?: string[];
              types?: string[];
            },
          ) => {
            addListener: (eventName: string, handler: () => void) => { remove: () => void };
            getPlace: () => GooglePlaceResult;
            setFields?: (fields: string[]) => void;
          };
        };
      };
    };
  }
}

export interface GoogleAddressComponent {
  long_name: string;
  short_name: string;
  types: string[];
}

export interface GooglePlaceResult {
  address_components?: GoogleAddressComponent[];
  formatted_address?: string;
}

export interface ParsedGoogleAddress {
  streetAddress: string;
  city: string;
  state: string;
  postalCode: string;
}

export function googlePlacesApiKey() {
  return import.meta.env.VITE_GOOGLE_MAPS_API_KEY || import.meta.env.PUBLIC_GOOGLE_MAPS_API_KEY || '';
}

export function isGooglePlacesConfigured() {
  return Boolean(googlePlacesApiKey());
}

export function loadGooglePlaces() {
  if (window.google?.maps?.places?.Autocomplete) return Promise.resolve();
  if (loaderPromise) return loaderPromise;

  const apiKey = googlePlacesApiKey();
  if (!apiKey) {
    loaderPromise = Promise.reject(new Error('Google Places API key is not configured.'));
    return loaderPromise;
  }

  loaderPromise = new Promise<void>((resolve, reject) => {
    const existing = document.getElementById(GOOGLE_MAPS_SCRIPT_ID) as HTMLScriptElement | null;
    if (existing) {
      existing.addEventListener('load', () => resolve(), { once: true });
      existing.addEventListener('error', () => reject(new Error('Google Places failed to load.')), { once: true });
      return;
    }

    const script = document.createElement('script');
    script.id = GOOGLE_MAPS_SCRIPT_ID;
    script.async = true;
    script.defer = true;
    script.src = `https://maps.googleapis.com/maps/api/js?${new URLSearchParams({
      key: apiKey,
      loading: 'async',
      libraries: 'places',
    })}`;
    script.addEventListener('load', () => resolve(), { once: true });
    script.addEventListener('error', () => reject(new Error('Google Places failed to load.')), { once: true });
    document.head.appendChild(script);
  });

  return loaderPromise;
}

function componentValue(components: GoogleAddressComponent[], type: string, key: 'long_name' | 'short_name' = 'long_name') {
  return components.find((component) => component.types.includes(type))?.[key] || '';
}

export function parseGoogleAddress(place: GooglePlaceResult): ParsedGoogleAddress | null {
  const components = place.address_components || [];
  if (!components.length) return null;

  const streetNumber = componentValue(components, 'street_number');
  const route = componentValue(components, 'route');
  const subpremise = componentValue(components, 'subpremise');
  const streetAddress = [streetNumber, route].filter(Boolean).join(' ');
  const unit = subpremise ? `#${subpremise}` : '';
  const city = componentValue(components, 'locality')
    || componentValue(components, 'postal_town')
    || componentValue(components, 'sublocality_level_1')
    || componentValue(components, 'administrative_area_level_2');
  const state = componentValue(components, 'administrative_area_level_1', 'short_name');
  const postalCode = componentValue(components, 'postal_code');

  return {
    streetAddress: [streetAddress, unit].filter(Boolean).join(' '),
    city,
    state,
    postalCode,
  };
}
