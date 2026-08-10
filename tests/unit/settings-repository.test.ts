/**
 * @vitest-environment happy-dom
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { SettingsRepository } from '../../src/storage/settings-repository.js';
import { DEFAULT_SETTINGS } from '../../src/shared/types.js';

// Fake chrome.storage.local
function makeFakeStorage() {
  const store: Record<string, unknown> = {};
  return {
    store,
    chrome: {
      storage: {
        local: {
          get: async (key: string) => {
            if (!(key in store)) return {};
            return { [key]: store[key] };
          },
          set: async (obj: Record<string, unknown>) => {
            Object.assign(store, obj);
          },
        },
      },
    } as unknown as typeof chrome,
  };
}

beforeEach(() => {
  (globalThis as { chrome?: typeof chrome }).chrome = undefined;
});

describe('SettingsRepository.load', () => {
  it('首次加载(无存储)返回默认值', async () => {
    const fake = makeFakeStorage();
    (globalThis as { chrome?: typeof chrome }).chrome = fake.chrome;
    const repo = new SettingsRepository();
    const settings = await repo.load();
    expect(settings).toEqual(DEFAULT_SETTINGS);
  });

  it('加载已保存的设置', async () => {
    const fake = makeFakeStorage();
    (globalThis as { chrome?: typeof chrome }).chrome = fake.chrome;
    fake.store['nosub-settings'] = {
      settings: {
        enabled: false,
        showTargetCaption: true,
        showTranslatedCaption: true,
        targetLanguage: 'en',
        translationLanguage: 'ja',
        interfaceLanguage: 'en',
        dictionarySource: 'server',
      },
      vocabulary: [],
      schemaVersion: 1,
    };
    const repo = new SettingsRepository();
    const settings = await repo.load();
    expect(settings.enabled).toBe(false);
    expect(settings.showTargetCaption).toBe(true);
    expect(settings.translationLanguage).toBe('ja');
    expect(settings.dictionarySource).toBe('server');
  });

  it('部分字段缺失 → 用默认值填充', async () => {
    const fake = makeFakeStorage();
    (globalThis as { chrome?: typeof chrome }).chrome = fake.chrome;
    fake.store['nosub-settings'] = {
      settings: { enabled: true }, // 只存了 enabled
      vocabulary: [],
      schemaVersion: 1,
    };
    const repo = new SettingsRepository();
    const settings = await repo.load();
    expect(settings.enabled).toBe(true);
    expect(settings.showTargetCaption).toBe(DEFAULT_SETTINGS.showTargetCaption);
    expect(settings.showTranslatedCaption).toBe(DEFAULT_SETTINGS.showTranslatedCaption);
  });

  it('损坏数据(非对象)→ 回退默认值', async () => {
    const fake = makeFakeStorage();
    (globalThis as { chrome?: typeof chrome }).chrome = fake.chrome;
    fake.store['nosub-settings'] = 'corrupted-string';
    const repo = new SettingsRepository();
    const settings = await repo.load();
    expect(settings).toEqual(DEFAULT_SETTINGS);
  });

  it('字段类型错误(布尔值存成字符串)→ 用默认值替代', async () => {
    const fake = makeFakeStorage();
    (globalThis as { chrome?: typeof chrome }).chrome = fake.chrome;
    fake.store['nosub-settings'] = {
      settings: { enabled: 'yes', showTargetCaption: 1 },
      vocabulary: [],
      schemaVersion: 1,
    };
    const repo = new SettingsRepository();
    const settings = await repo.load();
    expect(settings.enabled).toBe(DEFAULT_SETTINGS.enabled);
    expect(settings.showTargetCaption).toBe(DEFAULT_SETTINGS.showTargetCaption);
  });

  it('chrome.storage 不可用 → 回退默认值(不抛错)', async () => {
    // chrome 未定义
    const repo = new SettingsRepository();
    const settings = await repo.load();
    expect(settings).toEqual(DEFAULT_SETTINGS);
  });
});

describe('SettingsRepository.save', () => {
  it('保存设置写入 storage', async () => {
    const fake = makeFakeStorage();
    (globalThis as { chrome?: typeof chrome }).chrome = fake.chrome;
    const repo = new SettingsRepository();
    await repo.save({
      enabled: true,
      showTargetCaption: true,
      showTranslatedCaption: false,
      targetLanguage: 'en',
      translationLanguage: 'zh-CN',
      interfaceLanguage: 'auto',
      dictionarySource: 'public',
    });
    expect(fake.store['nosub-settings']).toBeDefined();
    expect((fake.store['nosub-settings'] as { settings: { showTargetCaption: boolean } }).settings.showTargetCaption).toBe(true);
  });

  it('保存后能再 load 回来', async () => {
    const fake = makeFakeStorage();
    (globalThis as { chrome?: typeof chrome }).chrome = fake.chrome;
    const repo = new SettingsRepository();
    const saved = {
      enabled: false,
      showTargetCaption: true,
      showTranslatedCaption: true,
      targetLanguage: 'en',
      translationLanguage: 'ko',
      interfaceLanguage: 'zh_CN' as const,
      dictionarySource: 'server' as const,
    };
    await repo.save(saved);
    const loaded = await repo.load();
    expect(loaded).toEqual(saved);
  });

  it('保存不覆盖已有的 vocabulary 字段', async () => {
    const fake = makeFakeStorage();
    (globalThis as { chrome?: typeof chrome }).chrome = fake.chrome;
    // 预存 vocabulary
    fake.store['nosub-settings'] = {
      settings: DEFAULT_SETTINGS,
      vocabulary: [{ id: 'v1', word: 'test' }],
      schemaVersion: 1,
    };
    const repo = new SettingsRepository();
    await repo.save({ ...DEFAULT_SETTINGS, enabled: false });
    const stored = fake.store['nosub-settings'] as { vocabulary: unknown[] };
    expect(stored.vocabulary).toEqual([{ id: 'v1', word: 'test' }]);
  });
});
