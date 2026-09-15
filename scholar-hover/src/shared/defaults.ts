import type { Settings } from './types';
export const DEFAULT_SETTINGS: Settings = {
  uiLanguage: 'zh-CN', outputLanguage: 'zh-CN',
  baseUrl: '', model: '', autoGenerate: true, consent: false, rememberKey: false,
};
export const HOVER_DELAY = 500;
export const PROMPT_VERSION = 'multilingual-abstract-v3';
export const CACHE_MAX = 200;
export const CACHE_TTL = 7 * 24 * 60 * 60 * 1000;
