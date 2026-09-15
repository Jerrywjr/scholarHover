import type { Language } from './languages';
export interface PaperSeed {
  title: string;
  authors: string[];
  year?: number;
  venue?: string;
  url: string;
  doi?: string;
  preprint?: boolean;
}
export interface Paper extends PaperSeed {
  id: string;
  abstract?: string;
  source: 'OpenAlex' | 'Crossref' | 'Google Scholar';
  sourceUrl: string;
  sources?: { name: string; url: string }[];
  matchStatus: 'matched' | 'confirmed' | 'unresolved';
}
export interface Resolution {
  paper: Paper;
  candidates: Paper[];
  warning?: string;
  timings?: Record<string, number>;
}
export interface Generated {
  titleTranslated: string;
  abstractTranslated: string | null;
  language: Language;
  summary: string | null;
  model: string;
  fingerprint: string;
  createdAt: number;
}
export interface Settings {
  uiLanguage: Language;
  outputLanguage: Language;
  baseUrl: string;
  model: string;
  autoGenerate: boolean;
  consent: boolean;
  rememberKey: boolean;
}
export interface SettingsView extends Settings {
  hasApiKey: boolean;
  hasOpenAlexKey: boolean;
}
export interface Credentials { apiKey: string; openAlexKey: string }
export type Request =
  | { type: 'RESOLVE'; seed: PaperSeed }
  | { type: 'CONFIRM'; candidateId: string; seed: PaperSeed }
  | { type: 'GENERATE'; paperId: string; force?: boolean }
  | { type: 'GET_CACHED'; paperId: string }
  | { type: 'GET_SETTINGS' }
  | { type: 'SAVE_SETTINGS'; settings: Settings; apiKey?: string; openAlexKey?: string }
  | { type: 'TEST_CONNECTION' }
  | { type: 'CLEAR_CACHE' }
  | { type: 'CLEAR_KEYS' }
  | { type: 'OPEN_SETTINGS' };
export type Response<T> = { ok: true; data: T } | { ok: false; error: string };
