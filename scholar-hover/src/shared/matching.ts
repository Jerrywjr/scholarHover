import type { PaperSeed } from './types';

/** The narrow subset of an OpenAlex work used to decide whether it is safe to use. */
export interface MatchableWork {
  id?: unknown;
  title?: unknown;
  doi?: unknown;
  type?: unknown;
  publication_year?: unknown;
  authorships?: unknown;
}

const DIACRITICS = /[\u0300-\u036f]/g;
const PUNCTUATION = /[^\p{L}\p{N}]+/gu;

export function normalizeTitle(value: string): string {
  return value.normalize('NFKD').replace(DIACRITICS, '').toLocaleLowerCase().replace(PUNCTUATION, ' ').trim().replace(/\s+/g, ' ');
}

export function normalizeDoi(value: string | undefined): string | undefined {
  if (!value) return undefined;
  const normalized = value.trim().replace(/^https?:\/\/(?:dx\.)?doi\.org\//i, '').toLocaleLowerCase();
  return /^10\.\d{4,9}\/.+/.test(normalized) ? normalized : undefined;
}

function isPreprint(work: MatchableWork): boolean {
  return typeof work.type === 'string' && /preprint/i.test(work.type);
}

function versionConflicts(seed: PaperSeed, work: MatchableWork): boolean {
  return seed.preprint === true ? !isPreprint(work) : seed.preprint === false && isPreprint(work);
}

function surnameAndGivenInitial(name: string): { surname: string; givenInitial?: string } | undefined {
  const pieces = name.normalize('NFKD').replace(DIACRITICS, '').toLocaleLowerCase().match(/[\p{L}\p{N}]+/gu);
  if (!pieces?.length) return undefined;
  // A single CJK family name is still useful, but must never be enough by itself
  // when initials are available on both sides.
  return { surname: pieces[pieces.length - 1], givenInitial: pieces[0]?.[0] };
}

function authorsOf(work: MatchableWork): string[] {
  if (!Array.isArray(work.authorships)) return [];
  return work.authorships.flatMap((authorship) => {
    if (!authorship || typeof authorship !== 'object') return [];
    const author = (authorship as { author?: unknown }).author;
    if (!author || typeof author !== 'object') return [];
    const displayName = (author as { display_name?: unknown }).display_name;
    return typeof displayName === 'string' ? [displayName] : [];
  });
}

/**
 * A Scholar author is often an initial plus surname.  An identical surname is
 * insufficient; when both sides expose a given-name initial, disagreement is
 * decisive.  This intentionally favors false negatives over wrong papers.
 */
export function authorsOverlap(seedAuthors: string[], candidateAuthors: string[]): boolean {
  if (!seedAuthors.length || !candidateAuthors.length) return false;
  const seeds = seedAuthors.map(surnameAndGivenInitial).filter((author): author is NonNullable<typeof author> => Boolean(author));
  const candidates = candidateAuthors.map(surnameAndGivenInitial).filter((author): author is NonNullable<typeof author> => Boolean(author));
  let overlap = false;
  for (const seed of seeds) {
    const sameSurname = candidates.filter((candidate) => candidate.surname === seed.surname);
    if (!sameSurname.length) continue;
    const compatible = sameSurname.some((candidate) =>
      !seed.givenInitial || !candidate.givenInitial || seed.givenInitial === candidate.givenInitial,
    );
    // A known first-initial disagreement for a named Scholar author is evidence
    // against the record, even if another coauthor happens to overlap.
    if (!compatible && seed.givenInitial && sameSurname.some((candidate) => candidate.givenInitial)) return false;
    overlap ||= compatible;
  }
  return overlap;
}

export function titlesObviouslyConflict(seedTitle: string, candidateTitle: unknown): boolean {
  if (typeof candidateTitle !== 'string' || !candidateTitle.trim()) return true;
  const seedTerms = new Set(normalizeTitle(seedTitle).split(' ').filter(Boolean));
  const candidateTerms = new Set(normalizeTitle(candidateTitle).split(' ').filter(Boolean));
  if (!seedTerms.size || !candidateTerms.size) return true;
  if (normalizeTitle(seedTitle) === normalizeTitle(candidateTitle)) return false;
  const overlap = [...seedTerms].filter((term) => candidateTerms.has(term)).length;
  return overlap / Math.max(seedTerms.size, candidateTerms.size) < 0.5;
}

/** Returns one candidate only when a title search establishes a unique, safe match. */
export function chooseUniqueMatch(seed: PaperSeed, works: MatchableWork[]): MatchableWork | undefined {
  if (!seed.year) return undefined;
  const title = normalizeTitle(seed.title);
  if (!title) return undefined;
  const matches = works.filter((work) =>
    typeof work.id === 'string'
    && typeof work.title === 'string'
    && normalizeTitle(work.title) === title
    && work.publication_year === seed.year
    && !versionConflicts(seed, work)
    && authorsOverlap(seed.authors, authorsOf(work)),
  );
  return matches.length === 1 ? matches[0] : undefined;
}

export function canUseDoiMatch(seed: PaperSeed, work: MatchableWork): boolean {
  const seedDoi = normalizeDoi(seed.doi);
  return Boolean(seedDoi
    && seedDoi === normalizeDoi(typeof work.doi === 'string' ? work.doi : undefined)
    && !versionConflicts(seed, work)
    && !titlesObviouslyConflict(seed.title, work.title));
}
