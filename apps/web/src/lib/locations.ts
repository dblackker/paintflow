export interface ZipLookupResult {
  zipCode: string;
  city: string;
  state: string;
  stateAbbr: string;
}

const zipCache = new Map<string, ZipLookupResult | null>();

export function cleanZip(value: string) {
  return value.replace(/\D/g, '').slice(0, 5);
}

export function isValidUsZip(value: string) {
  return /^\d{5}$/.test(value);
}

export async function lookupUsZip(value: string): Promise<ZipLookupResult | null> {
  const zipCode = cleanZip(value);
  if (!isValidUsZip(zipCode)) return null;
  if (zipCache.has(zipCode)) return zipCache.get(zipCode) || null;

  try {
    const response = await fetch(`https://api.zippopotam.us/us/${zipCode}`);
    if (!response.ok) {
      zipCache.set(zipCode, null);
      return null;
    }

    const payload = await response.json() as {
      'post code'?: string;
      places?: Array<{
        'place name'?: string;
        state?: string;
        'state abbreviation'?: string;
      }>;
    };
    const place = payload.places?.[0];
    if (!place?.['place name'] || !place['state abbreviation']) {
      zipCache.set(zipCode, null);
      return null;
    }

    const result = {
      zipCode,
      city: place['place name'],
      state: place.state || '',
      stateAbbr: place['state abbreviation'],
    };
    zipCache.set(zipCode, result);
    return result;
  } catch {
    return null;
  }
}
