#!/usr/bin/env node
import { readFile } from 'node:fs/promises';

const corpusArgument = process.argv.indexOf('--corpus');
const corpusPath = corpusArgument === -1 ? 'evaluation/corpus-100.json' : process.argv[corpusArgument + 1];
const requireHumanReview = process.argv.includes('--require-human-review');
const REQUIRED_RECORDS = 100;

function isObject(value) { return Boolean(value) && typeof value === 'object' && !Array.isArray(value); }
function nonEmptyString(value) { return typeof value === 'string' && value.trim().length > 0; }
function validTimestamp(value) { return nonEmptyString(value) && Number.isFinite(Date.parse(value)); }
function validHttpUrl(value) {
  if (!nonEmptyString(value)) return false;
  try { const url = new URL(value); return url.protocol === 'https:' || url.protocol === 'http:'; } catch { return false; }
}
function validReviewer(value) { return isObject(value) && nonEmptyString(value.reviewerId) && validTimestamp(value.reviewedAt); }
function adjudicationComplete(value) {
  if (value === true) return true;
  return isObject(value) && value.completed === true && validTimestamp(value.reviewedAt)
    && (value.reviewerId === undefined || nonEmptyString(value.reviewerId));
}
function reviewComplete(record) {
  const review = record.humanReview;
  return record.scholarSeed?.observedScholar === true
    && record.scholarSeed?.humanReviewed === true
    && validReviewer(review?.reviewerA)
    && validReviewer(review?.reviewerB)
    && review.reviewerA.reviewerId !== review.reviewerB.reviewerId
    && adjudicationComplete(review?.adjudicated);
}
function evaluationState(record) {
  const value = record.matchEvaluation;
  if (!isObject(value)) return { valid: false, reason: 'missing matchEvaluation' };
  if (value.mode === null && value.correct === null && value.observedAbstractAvailable === null) return { valid: true, complete: false };
  if (!['auto_matched', 'auto_unresolved'].includes(value.mode)) return { valid: false, reason: 'invalid matchEvaluation.mode' };
  if (typeof value.observedAbstractAvailable !== 'boolean') return { valid: false, reason: 'invalid observedAbstractAvailable' };
  if (value.mode === 'auto_matched' && typeof value.correct === 'boolean') return { valid: true, complete: true };
  if (value.mode === 'auto_unresolved' && value.correct === null) return { valid: true, complete: true };
  return { valid: false, reason: 'correct must be boolean for auto_matched and null for auto_unresolved' };
}
function validateCorpus(corpus) {
  if (!isObject(corpus) || !Array.isArray(corpus.records)) return ['records must be an array'];
  const errors = [];
  if (corpus.records.length !== REQUIRED_RECORDS) errors.push(`expected exactly ${REQUIRED_RECORDS} records, got ${corpus.records.length}`);
  const corpusIds = new Set();
  const dois = new Set();
  for (const [index, record] of corpus.records.entries()) {
    if (!isObject(record)) { errors.push(`record ${index} is not an object`); continue; }
    if (!nonEmptyString(record.corpusId)) errors.push(`record ${index} lacks corpusId`);
    else if (corpusIds.has(record.corpusId)) errors.push(`duplicate corpusId: ${record.corpusId}`);
    else corpusIds.add(record.corpusId);
    const doi = record.metadata?.doi;
    if (!nonEmptyString(doi)) errors.push(`record ${index} lacks DOI`);
    else if (dois.has(doi.toLowerCase())) errors.push(`duplicate DOI: ${doi}`);
    else dois.add(doi.toLowerCase());
    if (!validHttpUrl(record.sourceURL)) errors.push(`record ${index} has non-traceable sourceURL`);
    const evaluation = evaluationState(record);
    if (!evaluation.valid) errors.push(`record ${index} ${evaluation.reason}`);
    if (reviewComplete(record) && !evaluation.complete) errors.push(`record ${index} has completed review but incomplete matchEvaluation`);
  }
  return errors;
}

async function main() {
  let corpus;
  try { corpus = JSON.parse(await readFile(corpusPath, 'utf8')); }
  catch (error) { console.error(`INVALID CORPUS: ${error instanceof Error ? error.message : error}`); process.exitCode = 1; return; }
  const errors = validateCorpus(corpus);
  if (errors.length) { console.error(`INVALID CORPUS: ${errors.join('; ')}`); process.exitCode = 1; return; }
  const records = corpus.records;
  const reviewed = records.filter(reviewComplete);
  const translated = records.filter((record) => record.translationEvaluation?.reviewerId && record.translationEvaluation?.reviewedAt).length;
  const timingRecorded = records.filter((record) => Object.values(record.timing ?? {}).some((value) => typeof value === 'number')).length;
  const matched = reviewed.filter((record) => record.matchEvaluation.mode === 'auto_matched');
  const correct = matched.filter((record) => record.matchEvaluation.correct === true).length;
  const wrong = matched.filter((record) => record.matchEvaluation.correct === false).length;
  const unresolved = reviewed.filter((record) => record.matchEvaluation.mode === 'auto_unresolved').length;
  const abstractObserved = reviewed.filter((record) => record.matchEvaluation.observedAbstractAvailable === true).length;
  console.log(`Corpus: ${records.length} records; source: ${corpus.collection?.source ?? 'unknown'}`);
  console.log(`Human Scholar review/adjudication: ${reviewed.length}/${records.length}; translation review: ${translated}/${records.length}; timing observations: ${timingRecorded}/${records.length}`);
  console.log(`Match evaluation: ${correct} correct, ${wrong} wrong, ${unresolved} unresolved; observed abstract availability: ${abstractObserved}/${reviewed.length}`);
  if (reviewed.length !== REQUIRED_RECORDS) {
    console.log('NOT VALIDATED: this corpus is metadata-derived and awaits two-person human review of actual Scholar observations. It does not measure Google Scholar accuracy.');
    if (requireHumanReview) process.exitCode = 2;
  } else if (correct >= 80 && wrong === 0) {
    console.log(`PASS: ${correct} correct, ${wrong} wrong, ${unresolved} unresolved. This threshold applies only to the completed human-review fields.`);
  } else {
    console.log(`NOT VALIDATED: completed review does not meet the predeclared threshold (at least 80 correct and 0 wrong; observed ${correct} correct and ${wrong} wrong).`);
    if (requireHumanReview) process.exitCode = 2;
  }
}

main();
