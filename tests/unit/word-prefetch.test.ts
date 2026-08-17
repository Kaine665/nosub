import { describe, expect, it, vi } from 'vitest';
import { WordPopup, extractLookupWords } from '../../src/ui/components/word-popup.js';

describe('word prefetch extraction', () => {
  it('collects normalized unique words across caption cues', () => {
    expect(extractLookupWords([
      "Needed, we're testing real-time captions.",
      'Testing well-known words needed again!',
    ])).toEqual([
      'needed', "we're", 'testing', 'real-time', 'captions', 'well-known', 'words', 'again',
    ]);
  });

  it('ignores punctuation, numbers and one-letter tokens', () => {
    expect(extractLookupWords(['A / I / 42 — useful!'])).toEqual(['useful']);
  });
});

describe('word prefetch scheduler', () => {
  it('does not start deferred words until every priority word is complete', async () => {
    const popup = new WordPopup('en');
    const started: string[] = [];
    const releases = new Map<string, () => void>();
    const gates = new Map<string, Promise<unknown>>();
    for (const word of ['one', 'two', 'three', 'four', 'outer']) {
      gates.set(word, new Promise((resolve) => releases.set(word, () => resolve(undefined))));
    }

    const internals = popup as unknown as {
      refProvider: { lookup: (word: string) => Promise<unknown> };
      fetchTatoeba: (word: string) => Promise<unknown>;
      fetchServerExamples: (word: string) => Promise<unknown>;
    };
    internals.refProvider.lookup = vi.fn((word: string) => {
      started.push(word);
      return gates.get(word)!.then(() => null);
    });
    internals.fetchTatoeba = vi.fn((word: string) => gates.get(word)!.then(() => []));
    internals.fetchServerExamples = vi.fn((word: string) => gates.get(word)!.then(() => []));

    popup.prefetch(['one two three four'], ['outer']);
    expect(started).toEqual(['one', 'two', 'three']);

    releases.get('one')?.();
    await vi.waitFor(() => expect(started).toContain('four'));
    expect(started).not.toContain('outer');

    releases.get('two')?.();
    releases.get('three')?.();
    await Promise.resolve();
    expect(started).not.toContain('outer');

    releases.get('four')?.();
    await vi.waitFor(() => expect(started).toContain('outer'));
    releases.get('outer')?.();
    popup.dispose();
  });

  it('does not keep an empty definition result in the cache', async () => {
    const popup = new WordPopup('en');
    const lookup = vi.fn().mockResolvedValue(null);
    const internals = popup as unknown as {
      refProvider: { lookup: (word: string) => Promise<unknown> };
      lookupDefinitions: (word: string) => Promise<unknown>;
    };
    internals.refProvider.lookup = lookup;

    await internals.lookupDefinitions('needed');
    await internals.lookupDefinitions('needed');
    expect(lookup).toHaveBeenCalledTimes(2);
    popup.dispose();
  });

  it('shows provider definitions when strict display filtering rejects every line', () => {
    const popup = new WordPopup('en');
    const render = (popup as unknown as {
      render: (...args: unknown[]) => string;
    }).render.bind(popup);
    const html = render([
      {
        partOfSpeech: 'unclassified',
        definition: 'A useful definition returned by the provider even when its part of speech is unfamiliar.',
      },
    ], null, null, undefined, ['An example sentence.']);
    expect(html).toContain('A useful definition returned by the provider');
    expect(html).toContain('An example sentence.');
    popup.dispose();
  });

  it('uses the native Chinese dictionary before any Google fallback', async () => {
    const popup = new WordPopup('en', 'public', 'zh-CN');
    const nativeLookup = vi.fn().mockResolvedValue({
      language: 'zh-CN', entries: [{ partOfSpeech: 'v', definition: '需要' }],
    });
    const translate = vi.fn();
    const internals = popup as unknown as {
      refProvider: { lookup: (word: string) => Promise<unknown> };
      langProvider: { lookup: (word: string) => Promise<unknown> };
      fallbackTranslator: { translate: (result: unknown) => Promise<unknown> } | null;
      lookupDefinitions: (word: string) => Promise<{ langResult: unknown }>;
    };
    internals.refProvider.lookup = vi.fn().mockResolvedValue({
      language: 'en', entries: [{ partOfSpeech: 'verb', definition: 'to require' }],
    });
    internals.langProvider.lookup = nativeLookup;
    if (internals.fallbackTranslator) internals.fallbackTranslator.translate = translate;

    const result = await internals.lookupDefinitions('needed');
    expect(result.langResult).toEqual({
      language: 'zh-CN', entries: [{ partOfSpeech: 'v', definition: '需要' }],
    });
    expect(nativeLookup).toHaveBeenCalledOnce();
    expect(translate).not.toHaveBeenCalled();
    popup.dispose();
  });
});
