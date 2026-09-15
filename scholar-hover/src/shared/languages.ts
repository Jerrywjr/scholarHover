export const LANGUAGES = ['zh-CN', 'en', 'fr', 'de'] as const;
export type Language = typeof LANGUAGES[number];
export const LANGUAGE_NAMES: Record<Language, string> = {
  'zh-CN': '简体中文', en: 'English', fr: 'Français', de: 'Deutsch',
};
export const PROMPT_LANGUAGE_NAMES: Record<Language, string> = {
  'zh-CN': 'Simplified Chinese', en: 'English', fr: 'French', de: 'German',
};
