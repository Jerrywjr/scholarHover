import { describe, expect, it } from 'vitest';
import { previewKey } from '../src/shared/identity';
import type { PaperSeed } from '../src/shared/types';

const seed: PaperSeed = { title: 'A Useful Paper', authors: ['Alice Smith', 'Bob Chen'], year: 2020, url: 'https://EXAMPLE.com/paper?v=1', doi: '10.1000/ABC', preprint: false };

describe('preview identity', () => {
  it('normalizes letter case, whitespace, DOI wrappers and host casing', () => {
    expect(previewKey(seed)).toBe(previewKey({ ...seed, title: '  a  useful\nPAPER ', authors: [' alice  smith ', 'BOB CHEN'], url: 'https://example.com/paper?v=1', doi: 'https://doi.org/10.1000/abc' }));
  });

  it('ignores noisy venue labels', () => {
    expect(previewKey(seed)).toBe(previewKey({ ...seed, venue: 'Published in a journal - PDF' }));
  });

  it.each([
    { url: 'https://example.com/paper?v=2' },
    { url: 'https://example.com/Paper?v=1' },
    { url: 'https://example.com/preprint?v=1' },
    { doi: '10.1000/other' },
    { preprint: true },
    { preprint: undefined },
    { year: 2021 },
    { authors: ['Another Author'] },
  ])('keeps distinct papers and versions separate: %o', change => {
    expect(previewKey({ ...seed, ...change })).not.toBe(previewKey(seed));
  });

  it('uses structured fields so delimiters inside titles or author names cannot collide', () => {
    const one = { ...seed, title: 'A|B', authors: ['C'] };
    const two = { ...seed, title: 'A', authors: ['B|C'] };
    expect(previewKey(one)).not.toBe(previewKey(two));
  });
});
