import { GeoLite2 } from '@maxminddatabase/geolite2';

const countryReader = new GeoLite2('Country').reader;

/** Resolve a two-letter country code locally. The source IP is never returned or persisted. */
export function countryCodeForIp(ipAddress: string): string | null {
  try {
    const countryCode = countryReader.country(ipAddress).country?.isoCode?.toUpperCase();
    return countryCode && /^[A-Z]{2}$/.test(countryCode) ? countryCode : null;
  } catch {
    return null;
  }
}
