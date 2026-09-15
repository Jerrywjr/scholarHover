#!/usr/bin/env node
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';

const DEFAULT_SEED = 'scholar-hover-corpus-v1';
const TARGET_PER_DISCIPLINE = 25;
const DISCIPLINES = [
  { id: 'computer_science', query: 'machine learning' },
  { id: 'biomedicine', query: 'cancer immunotherapy' },
  { id: 'climate_science', query: 'climate change' },
  { id: 'social_science', query: 'social psychology' },
];
const API = 'https://api.openalex.org/works';
const OUTPUT = 'evaluation/corpus-100.json';

function argument(name) {
  const index = process.argv.indexOf(name);
  return index === -1 ? undefined : process.argv[index + 1];
}

function csvCell(value) {
  return `"${String(value ?? '').replaceAll('"', '""')}"`;
}

function hash(value) {
  let result = 2166136261;
  for (let index = 0; index < value.length; index += 1) result = Math.imul(result ^ value.charCodeAt(index), 16777619);
  return result >>> 0;
}

function dateYear(item) {
  return Number.isInteger(item.publication_year) ? item.publication_year : undefined;
}

function authors(item) {
  return (Array.isArray(item.authorships) ? item.authorships : [])
    .map((authorship) => {
      const name = authorship?.author?.display_name;
      return typeof name === 'string' ? name.trim() : undefined;
    })
    .filter(Boolean);
}

function asRecord(item, discipline, retrievedAt) {
  const doi = typeof item.doi === 'string' ? item.doi.replace(/^https?:\/\/doi\.org\//i, '').toLowerCase() : undefined;
  const title = typeof item.title === 'string' ? item.title.trim() : undefined;
  const authorNames = authors(item);
  const year = dateYear(item);
  if (!doi || !title || !authorNames.length || !year) return undefined;
  const sourceId = typeof item.id === 'string' ? item.id.match(/\/([^/?#]+)\/?$/)?.[1] : undefined;
  if (!sourceId) return undefined;
  const sourceURL = `${API}/${encodeURIComponent(sourceId)}`;
  const location = item.primary_location ?? {};
  const landingURL = typeof location.landing_page_url === 'string' && /^https?:\/\//i.test(location.landing_page_url) ? location.landing_page_url : `https://doi.org/${doi}`;
  return {
    corpusId: `openalex:${sourceId}`,
    discipline,
    source: 'OpenAlex',
    sourceURL,
    landingURL,
    retrievedAt,
    metadata: { title, authors: authorNames, year, doi, abstractAvailable: Boolean(item.abstract_inverted_index) },
    scholarSeed: {
      provenance: 'synthetic_from_metadata',
      observedScholar: false,
      humanReviewed: false,
      paperSeed: { title, authors: authorNames, year, doi, url: sourceURL },
    },
    humanReview: {
      reviewerA: { reviewerId: null, reviewedAt: null, titleMatchesScholar: null, authorsMatchScholar: null, yearMatchesScholar: null, doiMatchesScholar: null, notes: null },
      reviewerB: { reviewerId: null, reviewedAt: null, titleMatchesScholar: null, authorsMatchScholar: null, yearMatchesScholar: null, doiMatchesScholar: null, notes: null },
      adjudicated: null,
    },
    matchEvaluation: { mode: null, correct: null, observedAbstractAvailable: null },
    translationEvaluation: { reviewerId: null, reviewedAt: null, titleFaithful: null, abstractFaithful: null, summaryUseful: null, unsafeClaim: null, notes: null },
    timing: { resolveMs: null, generationMs: null, cardVisibleMs: null },
  };
}

function toCsv(records) {
  const header = ['corpusId', 'discipline', 'source', 'sourceURL', 'landingURL', 'retrievedAt', 'title', 'authors', 'year', 'doi', 'abstractAvailable', 'seedProvenance', 'observedScholar', 'humanReviewed', 'matchMode', 'matchCorrect', 'observedAbstractAvailable'];
  const rows = records.map((record) => [
    record.corpusId, record.discipline, record.source, record.sourceURL, record.landingURL, record.retrievedAt,
    record.metadata.title, record.metadata.authors.join('; '), record.metadata.year, record.metadata.doi,
    record.metadata.abstractAvailable, record.scholarSeed.provenance, record.scholarSeed.observedScholar, record.scholarSeed.humanReviewed,
    record.matchEvaluation.mode, record.matchEvaluation.correct, record.matchEvaluation.observedAbstractAvailable,
  ]);
  return [header, ...rows].map((row) => row.map(csvCell).join(',')).join('\n') + '\n';
}

async function requestDiscipline(discipline) {
  const url = new URL(API);
  url.searchParams.set('search', discipline.query);
  url.searchParams.set('filter', 'from_publication_date:2015-01-01,to_publication_date:2025-12-31,type:article');
  url.searchParams.set('per-page', '100');
  url.searchParams.set('select', 'id,doi,title,authorships,publication_year,abstract_inverted_index,primary_location,type');
  const response = await fetch(url, { headers: { accept: 'application/json' }, credentials: 'omit', redirect: 'error', signal: AbortSignal.timeout(15_000) });
  if (!response.ok) throw new Error(`OpenAlex ${discipline.id} request failed: HTTP ${response.status}`);
  const body = await response.json();
  if (!Array.isArray(body?.results)) throw new Error(`OpenAlex ${discipline.id} response lacks results`);
  return body.results;
}

async function main() {
  const refresh = process.argv.includes('--refresh');
  const output = argument('--output') ?? OUTPUT;
  const seed = argument('--seed') ?? DEFAULT_SEED;
  if (!refresh) {
    const corpus = JSON.parse(await readFile(output, 'utf8'));
    console.log(`Offline corpus retained: ${corpus.records.length} records in ${output}. No network request was made.`);
    console.log('To explicitly re-collect from OpenAlex: node scripts/collect-corpus.mjs --refresh --seed scholar-hover-corpus-v1');
    return;
  }

  const retrievedAt = new Date().toISOString();
  const selected = [];
  const seenDois = new Set();
  for (const discipline of DISCIPLINES) {
    const candidates = (await requestDiscipline(discipline))
      .map((item) => asRecord(item, discipline.id, retrievedAt))
      .filter(Boolean)
      .sort((left, right) => hash(`${seed}\u001f${discipline.id}\u001f${left.metadata.doi}`) - hash(`${seed}\u001f${discipline.id}\u001f${right.metadata.doi}`)
        || left.metadata.doi.localeCompare(right.metadata.doi));
    const chosen = candidates.filter((record) => !seenDois.has(record.metadata.doi)).slice(0, TARGET_PER_DISCIPLINE);
    if (chosen.length !== TARGET_PER_DISCIPLINE) throw new Error(`OpenAlex returned only ${chosen.length} usable ${discipline.id} records`);
    chosen.forEach((record) => seenDois.add(record.metadata.doi));
    selected.push(...chosen);
  }
  const corpus = {
    schemaVersion: 1,
    status: 'AWAITING_HUMAN_REVIEW',
    collection: {
      source: 'OpenAlex public REST API', sourceURL: API, retrievedAt, selectionSeed: seed,
      deterministicSelection: 'FNV-1a(seed, discipline, DOI), then first 25 valid unique records per discipline from the fixed API query.',
      noScholarAccess: true, noUserKeys: true, disciplines: DISCIPLINES,
    },
    records: selected,
  };
  await mkdir(path.dirname(output), { recursive: true });
  await writeFile(output, JSON.stringify(corpus, null, 2) + '\n');
  await writeFile(output.replace(/\.json$/, '.csv'), toCsv(selected));
  console.log(`Wrote ${selected.length} records to ${output}; status remains AWAITING_HUMAN_REVIEW.`);
}

main().catch((error) => { console.error(error instanceof Error ? error.message : error); process.exitCode = 1; });
