import { describe, expect, it, vi } from 'vitest';
import type { DefinitionProvider } from '../../src/assistance/definition-provider.js';
import { CompositeProvider, DictionaryRouter } from '../../src/assistance/dictionary-router.js';

function provider(
  name: string,
  result: Awaited<ReturnType<DefinitionProvider['lookup']>>,
): DefinitionProvider {
  return {
    name,
    language: 'en',
    lookup: vi.fn(async () => result),
  };
}

describe('DictionaryRouter', () => {
  it('公共 API 模式优先使用公共来源', () => {
    const router = new DictionaryRouter('public');
    expect(router.getProvider('en').name).toBe('dictionaryapi');
    expect(router.getProvider('zh_CN').name).toBe('iciba-zh');
  });

  it('服务器模式不会选择公共来源', () => {
    const router = new DictionaryRouter('server');
    expect(router.getProvider('en').name).toBe('nosub-server');
    expect(router.getProvider('zh_CN').name).toBe('nosub-server');
  });

  it('公共来源不可用时继续调用服务器兜底', async () => {
    const publicApi = provider('public', null);
    const serverResult = {
      language: 'en',
      entries: [{ partOfSpeech: 'noun', definition: 'fallback' }],
    };
    const server = provider('server', serverResult);
    const composite = new CompositeProvider([publicApi, server]);

    await expect(composite.lookup('word')).resolves.toEqual(serverResult);
    expect(publicApi.lookup).toHaveBeenCalledOnce();
    expect(server.lookup).toHaveBeenCalledOnce();
  });
});
