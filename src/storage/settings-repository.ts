/**
 * SettingsRepository —— design §10, tasks T13。
 *
 * chrome.storage.local 读写用户偏好。职责:
 * - 保存 enabled + showTargetCaption + showTranslatedCaption
 * - 刷新后恢复偏好
 * - 不持久化循环状态(循环是临时状态)
 * - 存储损坏或缺字段 → 回退安全默认值
 *
 * UI 不直接调存储 API,只通过此 Repository(design §10)。
 */

import type { UserSettings } from '../shared/types.js';
import { CURRENT_SCHEMA_VERSION, DEFAULT_SETTINGS, type StorageSchema } from '../shared/types.js';

const STORAGE_KEY = 'nosub-settings';

export class SettingsRepository {
  /**
   * 加载设置。损坏或缺失时回退默认值,并写回(自愈)。
   */
  async load(): Promise<UserSettings> {
    const raw = await this.readRaw();
    if (!raw) {
      return { ...DEFAULT_SETTINGS };
    }
    return this.mergeWithDefaults(raw.settings);
  }

  /**
   * 保存设置。覆盖写。
   */
  async save(settings: UserSettings): Promise<void> {
    const schema: StorageSchema = {
      settings,
      vocabulary: [], // vocabulary 由 VocabularyRepository 管理,这里不动
      schemaVersion: CURRENT_SCHEMA_VERSION,
    };
    await this.writeRaw({
      // 只写 settings 字段,避免覆盖 vocabulary
      ...(await this.readRaw()),
      settings,
      schemaVersion: CURRENT_SCHEMA_VERSION,
    } as StorageSchema);
    void schema; // schema 仅用于类型文档化
  }

  /** 合并:缺失字段用默认值填充,类型不对的字段也用默认值替代 */
  private mergeWithDefaults(partial: unknown): UserSettings {
    if (!partial || typeof partial !== 'object') {
      return { ...DEFAULT_SETTINGS };
    }
    const p = partial as Partial<UserSettings>;
    return {
      enabled: typeof p.enabled === 'boolean' ? p.enabled : DEFAULT_SETTINGS.enabled,
      showTargetCaption:
        typeof p.showTargetCaption === 'boolean'
          ? p.showTargetCaption
          : DEFAULT_SETTINGS.showTargetCaption,
      showTranslatedCaption:
        typeof p.showTranslatedCaption === 'boolean'
          ? p.showTranslatedCaption
          : DEFAULT_SETTINGS.showTranslatedCaption,
      targetLanguage: typeof p.targetLanguage === 'string' ? p.targetLanguage : DEFAULT_SETTINGS.targetLanguage,
      translationLanguage:
        typeof p.translationLanguage === 'string'
          ? p.translationLanguage
          : DEFAULT_SETTINGS.translationLanguage,
      interfaceLanguage:
        p.interfaceLanguage === 'en' || p.interfaceLanguage === 'zh_CN' || p.interfaceLanguage === 'auto'
          ? p.interfaceLanguage
          : DEFAULT_SETTINGS.interfaceLanguage,
    };
  }

  private async readRaw(): Promise<StorageSchema | null> {
    try {
      const result = await chrome.storage.local.get(STORAGE_KEY);
      const value = result[STORAGE_KEY];
      if (!value) return null;
      return value as StorageSchema;
    } catch {
      // 存储不可用(扩展上下文失效等):返回 null,上层用默认值
      return null;
    }
  }

  private async writeRaw(schema: StorageSchema): Promise<void> {
    try {
      await chrome.storage.local.set({ [STORAGE_KEY]: schema });
    } catch {
      // 写失败:静默(下次会重试;不影响当前会话内存中的设置)
    }
  }
}
