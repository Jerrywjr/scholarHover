import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

const root = path.resolve(import.meta.dirname, '..');
const evaluator = path.join(root, 'scripts/evaluate-corpus.mjs');
const temp = await mkdtemp(path.join(tmpdir(), 'scholar-hover-eval-'));

function record(index, overrides = {}) {
  return {
    corpusId: `openalex:W${index}`,
    sourceURL: `https://api.openalex.org/works/W${index}`,
    metadata: { doi: `10.1000/example.${index}` },
    scholarSeed: { observedScholar: false, humanReviewed: false },
    humanReview: { reviewerA: null, reviewerB: null, adjudicated: null },
    matchEvaluation: { mode: null, correct: null, observedAbstractAvailable: null },
    ...overrides,
  };
}

async function fixture(name, records) {
  const file = path.join(temp, `${name}.json`);
  await writeFile(file, JSON.stringify({ collection: { source: 'fixture' }, records }));
  return file;
}

function run(file) {
  return spawnSync(process.execPath, [evaluator, '--corpus', file], { encoding: 'utf8' });
}

const empty = run(await fixture('empty', []));
assert.notEqual(empty.status, 0);
assert.match(empty.stderr, /INVALID CORPUS/);

const duplicate = run(await fixture('duplicate', Array.from({ length: 100 }, (_, index) => record(index === 99 ? 0 : index))));
assert.notEqual(duplicate.status, 0);
assert.match(duplicate.stderr, /duplicate DOI|duplicate corpusId/);

const completed = Array.from({ length: 100 }, (_, index) => record(index, {
  scholarSeed: { observedScholar: true, humanReviewed: true },
  humanReview: {
    reviewerA: { reviewerId: 'reviewer-a', reviewedAt: '2026-09-04T00:00:00.000Z' },
    reviewerB: { reviewerId: 'reviewer-b', reviewedAt: '2026-09-04T00:01:00.000Z' },
    adjudicated: { completed: true, reviewerId: 'adjudicator', reviewedAt: '2026-09-04T00:02:00.000Z' },
  },
  matchEvaluation: index < 80
    ? { mode: 'auto_matched', correct: true, observedAbstractAvailable: index % 2 === 0 }
    : { mode: 'auto_unresolved', correct: null, observedAbstractAvailable: index % 2 === 0 },
}));
const passing = run(await fixture('completed', completed));
assert.equal(passing.status, 0, passing.stderr);
assert.match(passing.stdout, /PASS: 80 correct, 0 wrong, 20 unresolved/);

console.log('evaluate-corpus subprocess tests passed');
