import { describe, expect, it } from 'vitest';
import { countryCodeForIp } from '../../server/src/geo-location.js';

describe('local country lookup', () => {
  it('returns a country code without exposing the source IP', () => {
    expect(countryCodeForIp('8.8.8.8')).toBe('US');
  });

  it('returns null for local or invalid addresses', () => {
    expect(countryCodeForIp('127.0.0.1')).toBeNull();
    expect(countryCodeForIp('not-an-ip')).toBeNull();
  });
});
