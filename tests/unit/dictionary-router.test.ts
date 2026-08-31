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
  it('公共 API 模式仍优先使用稳定的 NoSub 词库', () => {
    const router = new DictionaryRouter('public');
    expect(router.getProvider('en').name).toBe('nosub-server');
    expect(router.getProvider('zh_CN').name).toBe('nosub-server');
    expect(router.getNativeProvider('zh-CN')?.name).toBe('nosub-server');
    expect(router.getNativeProvider('ja')).toBeNull();
  });

  it('服务器模式不会选择公共来源', () => {
    const router = new DictionaryRouter('server');
    expect(router.getProvider('en').name).toBe('nosub-server');
    expect(router.getProvider('zh_CN').name).toBe('nosub-server');
  });

  it('NoSub 词库不可用时才继续调用公共来源', async () => {
    const server = provider('server', null);
    const publicResult = {
      language: 'en',
      entries: [{ partOfSpeech: 'noun', definition: 'fallback' }],
    };
    const publicApi = provider('public', publicResult);
    const composite = new CompositeProvider([server, publicApi]);

    await expect(composite.lookup('word')).resolves.toEqual(publicResult);
    expect(server.lookup).toHaveBeenCalledOnce();
    expect(publicApi.lookup).toHaveBeenCalledOnce();
  });
});
