/**
 * 释义提供方抽象层。
 * 每个 provider 返回一种语言的释义。可自由组合中/英/日等。
 */

export interface DefinitionEntry {
  /** 词性(如 "verb", "noun") */
  partOfSpeech: string;
  /** 释义文本 */
  definition: string;
  /** 例句(可选) */
  example?: string;
}

export interface DefinitionResult {
  /** 语言代码 */
  language: string;
  /** 该语言的释义列表, 按常用度排序 */
  entries: DefinitionEntry[];
  /** Optional pronunciation metadata supplied by the same lookup source. */
  phonetic?: string;
  phoneticUK?: string;
  phoneticUS?: string;
  audioUK?: string;
  audioUS?: string;
}

export interface DefinitionProvider {
  readonly name: string;
  readonly language: string;

  /**
   * 查询单词释义。
   * @param word 要查询的词
   * @returns 释义结果, 或 null 表示不可用
   */
  lookup(word: string): Promise<DefinitionResult | null>;
}
