import test from 'node:test';
import assert from 'node:assert/strict';
import { loadData } from '../src/data.js';
import { extractRequirements, analyzeMatches, analyzeResumeCoverage, displayedText } from '../src/matcher.js';
import { buildChange, validateSuggestions, applyApproved, combineSuggestions } from '../src/editor.js';
import { checkRewrite, inferredCompetencies, reviewRewrites, rewriteSources } from '../src/rewrite-validation.js';
import { renderLatex } from '../src/latex.js';
import { validatePdfText } from '../src/pdf-validation.js';
const { profile, resumes } = await loadData();
const resume = resumes.backend_infra;
const row = (keyword, category = 'required_technical_skill', priority = 'critical') => ({ keyword, source: keyword, category, priority });
const rawAnalysis = { recommended_resume: 'backend_infra', requirements: [row('Go'), row('Kafka'), row('Docker'), row('Kubernetes', 'preferred_technical_skill'), row('Ruby on Rails')] };
const jd = 'Go Kafka Docker Kubernetes Ruby on Rails';
const analysis = analyzeMatches(jd, rawAnalysis, profile, resumes);
const proposal = (extra = {}) => ({ operation: 'bullet_rewrite', section: 'projects', targetId: 'video', itemId: 'video_services', sourceBulletIds: ['video_services'], proposed: 'Engineered fault-tolerant ingestion and delivery with independent producer and consumer services, buffering metrics in Kafka during downstream outages.', reason: 'Make demonstrated failure isolation and service boundaries explicit.', jdKeyword: 'Kafka', confidence: 0.95, ...extra });
const reviewer = (overrides = {}) => ({ reviewEdits: async ({ candidates }) => ({ reviews: candidates.map(c => ({ id: c.id, supported: true, improves: true, unsupportedClaims: [], reason: 'Names fault tolerance supported by outage buffering.', ...overrides })) }) });

test('critical requirements deduplicate and outrank preferred skills without counts or frequency targets', () => {
  const rows = extractRequirements('Go Go Golang Kubernetes', { requirements: [row('Go'), row('Golang'), row('Kubernetes', 'preferred_technical_skill', 'critical')] }, profile);
  assert.equal(rows.length, 2);
  assert.equal(rows[0].priority, 'critical');
  assert.equal(rows[1].priority, 'medium');
});

test('narrow competency implications are recognized without inventing related technologies', () => {
  assert.ok(inferredCompetencies('Implemented retries and failure isolation').includes('Fault-tolerant system design'));
  assert.ok(inferredCompetencies('Built queues and workers').includes('Asynchronous processing'));
  assert.ok(inferredCompetencies('Designed persistent state and deduplication').includes('Stateful service design'));
  assert.deepEqual(inferredCompetencies('Used Docker'), ['Containerization']);
  assert.deepEqual(inferredCompetencies('Built an API using an LLM'), []);
  const result = analyzeResumeCoverage('Fault-tolerant system design', { requirements: [row('Fault-tolerant system design', 'engineering_competency', 'high')] }, profile, resume);
  assert.equal(result.requirements[0].status, 'equivalent');
  assert.ok(result.requirements[0].evidence.some(b => b.id.endsWith('video_services')));
});

test('a major evidence-backed rewrite requires a separate review and reaches renderer and coverage', async () => {
  const raw = proposal();
  assert.equal(buildChange(raw, analysis, profile, resume), null);
  const { reviews } = await reviewRewrites(reviewer(), [raw], analysis, profile, resume);
  const changes = validateSuggestions([raw], analysis, profile, resume, reviews);
  assert.equal(changes.length, 1);
  assert.equal(changes[0].proposed, raw.proposed);
  const tailored = applyApproved(resume, changes, [changes[0].id]);
  assert.ok(displayedText(profile, tailored).includes(raw.proposed));
  assert.ok((await renderLatex(profile, tailored)).includes(raw.proposed));
  assert.deepEqual(tailored.experience, resume.experience);
  assert.deepEqual(tailored.education, resume.education);
  assert.equal(buildChange({ ...raw, proposed: raw.proposed + ' at scale' }, analysis, profile, resume, reviews), null);
});

test('metrics, technology provenance, hidden text, and ownership have deterministic guards', () => {
  const sources = rewriteSources(profile, 'experience', 'datadog_2026', ['dd_gpu']);
  const original = sources[0].text;
  assert.equal(checkRewrite(original, original.replace('$100,000+', '$200,000+'), sources, profile, analysis), false);
  assert.equal(checkRewrite(original, original + ' with Docker.', sources, profile, analysis), false);
  assert.equal(checkRewrite(original, 'Led ' + original, sources, profile, analysis), false);
  assert.equal(checkRewrite(original, original + '\u200b', sources, profile, analysis), false);
  const video = rewriteSources(profile, 'projects', 'video', ['video_services']);
  assert.equal(checkRewrite(video[0].text, proposal().proposed + ' using Ruby on Rails.', video, profile, analysis), false);
  assert.equal(checkRewrite(video[0].text, proposal().proposed + ' in Kubernetes.', video, profile, analysis), false);
  assert.equal(rewriteSources(profile, 'projects', 'video', ['dd_gpu']), null);
});

test('semantic audit rejects invented tools and potential-to-realized savings, and flags confirmation', async () => {
  const gpu = profile.experience[0].bullets[0];
  const raw = proposal({ section: 'experience', targetId: 'datadog_2026', itemId: 'dd_gpu', sourceBulletIds: ['dd_gpu'], jdKeyword: 'Go', proposed: 'Saved $100,000+ in GPU costs for 3,000+ engineers by reclaiming underutilized reservations.' });
  const result = await reviewRewrites(reviewer({ supported: false, unsupportedClaims: ['Realized savings were not verified.'] }), [raw], analysis, profile, resume);
  assert.equal(result.reviews.size, 0);
  assert.match(result.confirmations[0].claim, /Realized/);
  assert.equal(validateSuggestions([raw], analysis, profile, resume, result.reviews).length, 0);
  // Unknown technology is still rejected by the semantic audit, even outside JD/catalog.
  const unknown = proposal({ proposed: proposal().proposed + ' using RabbitMQ.' });
  assert.equal((await reviewRewrites(reviewer({ supported: false, unsupportedClaims: ['RabbitMQ is unsupported.'] }), [unknown], analysis, profile, resume)).reviews.size, 0);
  assert.ok(gpu.text.includes('Surfaced'));
});

test('missing, ambiguous, failed and cosmetic reviews cannot approve rewrites', async () => {
  const raw = proposal();
  for (const provider of [reviewer({ improves: false }), reviewer({ supported: 'true' }), { reviewEdits: async () => ({}) }, { reviewEdits: async ({ candidates }) => ({ reviews: [0, 1].map(() => ({ id: candidates[0].id, supported: true, improves: true, unsupportedClaims: [], reason: 'ok' })) }) }]) {
    assert.equal((await reviewRewrites(provider, [raw], analysis, profile, resume)).reviews.size, 0);
  }
  await assert.rejects(reviewRewrites({ reviewEdits: async () => { throw Error('timeout'); } }, [raw], analysis, profile, resume), /timeout/);
  assert.equal(buildChange(proposal({ proposed: profile.projects.find(e => e.id === 'video').bullets[1].text }), analysis, profile, resume), null);
});

test('multiple bullets in an entry can be strengthened and reordered without a five-edit cap', async () => {
  const first = proposal();
  const second = proposal({ itemId: 'video_pipeline', sourceBulletIds: ['video_pipeline'], proposed: 'Engineered asynchronous processing of YouTube metrics through an event-driven Confluent Cloud Kafka pipeline into a Telegram notification service.' });
  const { reviews } = await reviewRewrites(reviewer(), [first, second], analysis, profile, resume);
  const changes = validateSuggestions([first, second, { ...first, operation: 'bullet_reorder', order: ['video_services', 'video_pipeline'] }], analysis, profile, resume, reviews);
  assert.equal(changes.length, 3);
  const tailored = applyApproved(resume, changes, changes.map(c => c.id));
  assert.equal(tailored.projects.find(e => e.entryId === 'video').bulletIds[0], 'video_services');
  assert.equal(Object.keys(tailored.rewrites).length, 2);
  const independent = Array.from({ length: 12 }, (_, i) => ({ id: `c${i}`, conflictKey: `b${i}`, edit: { operation: 'bullet_rewrite', section: 'projects', targetId: `p${i}` } }));
  assert.equal(combineSuggestions(independent, []).length, 12);
});

test('skills optimization preserves breadth and ranks all supported requirements; unknown tools are rejected', () => {
  const base = structuredClone(resume);
  base.skillGroups[0].skillIds = ['python', 'java'];
  const a = analyzeMatches('Go Java Python', { requirements: [row('Go'), row('Java', 'required_technical_skill', 'high'), row('Python', 'preferred_technical_skill')] }, profile, { ...resumes, backend_infra: base });
  const raw = { operation: 'skill_optimize', section: 'skills', targetId: 'Languages', order: ['go', 'java', 'python'], jdKeyword: 'Go', reason: 'Put required languages before preferred Python.', confidence: 0.9 };
  const change = buildChange(raw, a, profile, base);
  assert.ok(change);
  assert.equal(buildChange({ ...raw, order: ['go', 'python', 'java'] }, a, profile, base), null);
  assert.equal(buildChange({ ...raw, order: ['go', 'ruby', 'python'] }, a, profile, base), null);
  assert.equal(buildChange({ ...raw, order: ['go', 'java'] }, a, profile, base), null);
});

test('PDF extraction validates rewritten text rather than the original bullet', async () => {
  const raw = proposal();
  const { reviews } = await reviewRewrites(reviewer(), [raw], analysis, profile, resume);
  const changes = validateSuggestions([raw], analysis, profile, resume, reviews);
  const tailored = applyApproved(resume, changes, changes.map(c => c.id));
  // A missing rewritten bullet is an export failure even if original text survives.
  const validation = validatePdfText(displayedText(profile, resume), profile, tailored, ['Kafka']);
  assert.ok(validation.errors.some(e => e.includes('video_services')));
});

test('JavaScript and JS are equivalent while TypeScript stays a distinct requirement', () => {
  const rows = extractRequirements('JavaScript JS TypeScript', { requirements: ['JavaScript', 'JS', 'TypeScript'].map(k => row(k)) }, profile);
  assert.equal(rows.length, 2);
  const result = analyzeResumeCoverage('JS', { requirements: [row('JS')] }, profile, resumes.general_swe);
  assert.equal(result.requirements[0].status, 'equivalent');
  const source = [{ id: 'ts', text: 'Built a TypeScript interface.', variants: [], skillIds: ['typescript_js'] }];
  assert.equal(checkRewrite(source[0].text, 'Engineered a JavaScript interface.', source, profile, analysis), false);
});

test('replacement uses only a more relevant verified accomplishment from the same entry', () => {
  const base = structuredClone(resume);
  const selection = base.experience.find(e => e.entryId === 'datadog_2026');
  selection.bulletIds = ['dd_gpu', 'dd_chargeback'];
  const raw = { operation: 'bullet_replace', section: 'experience', targetId: 'datadog_2026', itemId: 'dd_chargeback', replacementId: 'dd_ingest', jdKeyword: 'Go', reason: 'Emphasize Go engineering over chargeback details.', confidence: 0.9 };
  const changes = validateSuggestions([raw], analysis, profile, base);
  assert.equal(changes.length, 1);
  const tailored = applyApproved(base, changes, changes.map(c => c.id));
  assert.deepEqual(tailored.experience[0].bulletIds, ['dd_gpu', 'dd_ingest']);
  assert.equal(buildChange({ ...raw, replacementId: 'video_services' }, analysis, profile, base), null);
  assert.equal(buildChange({ ...raw, replacementId: 'made_up' }, analysis, profile, base), null);
});

test('a JavaScript source excerpt cannot ground a TypeScript requirement', () => {
  assert.deepEqual(extractRequirements('JavaScript', { requirements: [{ ...row('TypeScript'), source: 'JavaScript' }] }, profile), []);
});

test('rewrites can normalize an evidenced technology alias without metadata', () => {
  const sources = [{ id: 'db', text: 'Built a Postgres service.', variants: [], skillIds: [] }];
  assert.equal(checkRewrite(sources[0].text, 'Engineered a PostgreSQL service.', sources, profile, analysis), true);
});
