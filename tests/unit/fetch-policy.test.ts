import { describe, expect, it } from 'vitest';
import { isAllowedBackgroundFetch } from '../../src/background/fetch-policy.js';

describe('background fetch policy', () => {
  it('allows known dictionary and example endpoints', () => {
    expect(isAllowedBackgroundFetch('dict-fetch', 'https://api.dictionaryapi.dev/api/v2/entries/en/needed')).toBe(true);
    expect(isAllowedBackgroundFetch('dict-fetch', 'https://tatoeba.org/en/api_v0/search?query=needed')).toBe(true);
    expect(isAllowedBackgroundFetch('dict-fetch', 'https://dict.youdao.com/jsonapi?q=needed')).toBe(true);
    expect(isAllowedBackgroundFetch('dict-fetch', 'https://api-nosub.43-130-246-125.sslip.io/dictionary/word/en/needed')).toBe(true);
  });

  it('keeps each request type scoped to its providers', () => {
    expect(isAllowedBackgroundFetch('translate-fetch', 'https://translate.googleapis.com/translate_a/single')).toBe(true);
    expect(isAllowedBackgroundFetch('translate-fetch', 'https://tatoeba.org/en/api_v0/search')).toBe(false);
    expect(isAllowedBackgroundFetch('audio-fetch', 'https://dict.youdao.com/dictvoice?audio=needed')).toBe(true);
    expect(isAllowedBackgroundFetch('audio-fetch', 'https://api-nosub.43-130-246-125.sslip.io/dictionary/audio/needed')).toBe(true);
  });

  it('rejects lookalike hosts, credentials, protocols and ports', () => {
    expect(isAllowedBackgroundFetch('dict-fetch', 'https://tatoeba.org.evil.example/search')).toBe(false);
    expect(isAllowedBackgroundFetch('dict-fetch', 'https://user:pass@tatoeba.org/search')).toBe(false);
    expect(isAllowedBackgroundFetch('dict-fetch', 'javascript:alert(1)')).toBe(false);
    expect(isAllowedBackgroundFetch('dict-fetch', 'http://43.130.246.125:8899/api/word/en/test')).toBe(false);
    expect(isAllowedBackgroundFetch('dict-fetch', 'https://api-nosub.43-130-246-125.sslip.io/health')).toBe(false);
    expect(isAllowedBackgroundFetch('audio-fetch', 'https://api-nosub.43-130-246-125.sslip.io/dictionary/word/en/test')).toBe(false);
  });
});
