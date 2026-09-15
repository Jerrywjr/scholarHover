import { describe, expect, it } from 'vitest';
import type { PaperSeed } from '../src/shared/types';
import { authorsOverlap, chooseUniqueMatch, normalizeTitle } from '../src/shared/matching';

const seed: PaperSeed = {
  title: 'Learning Representations with Contrastive Predictive Coding',
  authors: ['A. van den Oord', 'Y. Li'],
  year: 2018,
  url: 'https://scholar.google.com/scholar?cluster=1',
};

describe('normalizeTitle', () => {
  it('normalizes punctuation, whitespace, and diacritics without dropping non-Latin text', () => {
    expect(normalizeTitle('  Caf\u00e9: \u5b66\u4e60  --  Systems! ')).toBe('cafe \u5b66\u4e60 systems');
  });
});

describe('chooseUniqueMatch', () => {
  it('does not accept a top search result belonging to a different author', () => {
    const result = chooseUniqueMatch(seed, [
      { id: 'https://openalex.org/W-wrong', title: seed.title, publication_year: 2018, authorships: [{ author: { display_name: 'R. Smith' } }] },
      { id: 'https://openalex.org/W-right', title: seed.title, publication_year: 2018, authorships: [{ author: { display_name: 'Aaron van den Oord' } }, { author: { display_name: 'Y. Li' } }] },
    ]);

    expect(result?.id).toBe('https://openalex.org/W-right');
  });

  it('leaves same-title records unresolved when more than one candidate matches', () => {
    const result = chooseUniqueMatch(seed, [
      { id: 'https://openalex.org/W-1', title: seed.title, publication_year: 2018, authorships: [{ author: { display_name: 'A. van den Oord' } }, { author: { display_name: 'Y. Li' } }] },
      { id: 'https://openalex.org/W-2', title: seed.title, publication_year: 2018, authorships: [{ author: { display_name: 'A. van den Oord' } }, { author: { display_name: 'Y. Li' } }] },
    ]);

    expect(result).toBeUndefined();
  });

  it('requires a year for title-search matching', () => {
    const result = chooseUniqueMatch({ ...seed, year: undefined }, [
      { id: 'https://openalex.org/W-1', title: seed.title, publication_year: 2018, authorships: [{ author: { display_name: 'A. van den Oord' } }, { author: { display_name: 'Y. Li' } }] },
    ]);

    expect(result).toBeUndefined();
  });

  it('rejects initial conflicts instead of using a surname-only match', () => {
    const result = chooseUniqueMatch(seed, [
      { id: 'https://openalex.org/W-1', title: seed.title, publication_year: 2018, authorships: [{ author: { display_name: 'B. van den Oord' } }, { author: { display_name: 'Y. Li' } }] },
    ]);

    expect(result).toBeUndefined();
  });

  it('does not resolve a preprint seed to a published DOI version', () => {
    const result = chooseUniqueMatch({ ...seed, preprint: true }, [
      { id: 'https://openalex.org/W-1', title: seed.title, publication_year: 2018, doi: 'https://doi.org/10.1000/published', type: 'article', authorships: [{ author: { display_name: 'A. van den Oord' } }, { author: { display_name: 'Y. Li' } }] },
    ]);

    expect(result).toBeUndefined();
  });
});

describe('authorsOverlap', () => {
  it('uses available initials with Unicode surnames instead of accepting surnames alone', () => {
    expect(authorsOverlap(['Y. \u738b'], ['Y. \u738b'])).toBe(true);
    expect(authorsOverlap(['Y. \u738b'], ['B. \u738b'])).toBe(false);
  });
});
