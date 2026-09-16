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
  downloadUrl?: string;
  downloadVersion?: string;
  abstract?: string;
  source: 'OpenAlex' | 'Crossref' | 'Google Scholar';
  sourceUrl: string;
  sources?: { name: string; url: string }[];
  matchStatus: 'matched' | 'confirmed' | 'unresolved';
}
export interface Resolution {
  cacheWarning?: string;
  paper: Paper;
  candidates: Paper[];
  warning?: string;
  timings?: Record<string, number>;
}
export interface Generated {
  collectionWarning?: string;
  cacheWarning?: string;
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
export type CompletionStatus = 'queued' | 'resolving' | 'generating' | 'ready' | 'needs-confirmation' | 'needs-configuration' | 'failed' | 'interrupted';
export interface PaperCompletion { status: CompletionStatus; updatedAt: number; error?: string }
export interface SavedPaper {
  id: string;
  paper: Paper;
  sourceKey?: string;
  seed?: PaperSeed;
  completion?: PaperCompletion;
  candidates?: Paper[];
  generated?: Generated;
  savedAt: number;
  updatedAt: number;
}
export interface CollectionSnapshot { revision: number; items: SavedPaper[] }
export type PreviewState = 'unviewed' | 'viewed' | 'saved' | 'unknown';
export interface PreviewSnapshot { resolution?: Resolution; generated?: Generated; saved?: SavedPaper }
export type DownloadState = 'queued' | 'downloading' | 'complete' | 'failed';
export interface ExportItem {
  id: string;
  number: number;
  title: string;
  filename: string;
  url?: string;
  pageUrl: string;
  state: DownloadState;
  downloadId?: number;
  error?: string;
  authOpened?: boolean;
}
export interface ExportBatch {
  id: string;
  createdAt: number;
  folder: string;
  authPageOpened?: boolean;
  items: ExportItem[];
  markdown: { filename: string; state: DownloadState; downloadId?: number; error?: string };
}
export type Request =
  | { type: 'RESOLVE'; seed: PaperSeed }
  | { type: 'CONFIRM'; candidateId: string; seed: PaperSeed }
  | { type: 'GENERATE'; paperId: string; force?: boolean }
  | { type: 'GET_CACHED'; paperId: string }
  | { type: 'GET_PREVIEW'; seed: PaperSeed }
  | { type: 'GET_PREVIEW_STATES'; seeds: PaperSeed[] }
  | { type: 'GET_SETTINGS' }
  | { type: 'SAVE_SETTINGS'; settings: Settings; apiKey?: string; openAlexKey?: string }
  | { type: 'TEST_CONNECTION' }
  | { type: 'CLEAR_CACHE' }
  | { type: 'CLEAR_KEYS' }
  | { type: 'OPEN_SETTINGS' }
  | { type: 'SAVE_PAPER'; paperId?: string; seed?: PaperSeed }
  | { type: 'RETRY_SAVED'; id: string }
  | { type: 'CONFIRM_SAVED'; id: string; candidateId: string }
  | { type: 'OPEN_COLLECTION' }
  | { type: 'GET_COLLECTION' }
  | { type: 'REMOVE_SAVED'; id: string; revision: number }
  | { type: 'REORDER_SAVED'; ids: string[]; revision: number }
  | { type: 'CLEAR_COLLECTION'; revision: number }
  | { type: 'EXPORT_COLLECTION'; revision: number }
  | { type: 'GET_EXPORT' }
  | { type: 'RETRY_DOWNLOAD'; batchId: string; itemId: string };
export type Response<T> = { ok: true; data: T } | { ok: false; error: string };
