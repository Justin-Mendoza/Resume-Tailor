import test from 'node:test';
import assert from 'node:assert/strict';
import { loadData } from '../src/data.js';
import { analyzeMatches } from '../src/matcher.js';
import { fallbackSuggestions } from '../src/editor.js';
import { refineResume, prepareRefinement } from '../src/refinement.js';
import { createKymaProvider } from '../src/providers/kyma.js';
const { profile, resumes } = await loadData();
const analysis = analyzeMatches('Go Kafka Kubernetes', { important_keywords: ['Go', 'Kafka', 'Kubernetes'] }, profile, resumes);
const resume = resumes.backend_infra;
const existingChanges = fallbackSuggestions(analysis, profile, resume);
const input = { input: {}, analysis, profile, resume, existingChanges };
const success = content => ({ ok: true, json: async () => ({ choices: [{ finish_reason: 'stop', message: { content } }] }) });

test('generation errors identify the stage and timeout without leaking credentials or resume data', async () => {
  const result = await refineResume({ ...input, provider: { suggestEdits: async () => { throw Object.assign(Error('secret-key raw private prompt'), { code: 'TIMEOUT' }); } } });
  assert.equal(result.diagnostics.stage, 'generation');
  assert.equal(result.diagnostics.code, 'TIMEOUT');
  assert.match(result.warning, /timed out/);
  assert.doesNotMatch(JSON.stringify(result.diagnostics), /secret-key|private prompt/);
  assert.equal(result.changes, existingChanges);
});

test('a review timeout withholds new prose but preserves valid model edits and local suggestions', async () => {
  const rewrite = { operation: 'bullet_rewrite', section: 'projects', targetId: 'video', itemId: 'video_services', sourceBulletIds: ['video_services'], proposed: 'Engineered fault-tolerant ingestion and delivery with independent producer and consumer services, buffering metrics in Kafka during downstream outages.', jdKeyword: 'Kafka', reason: 'Surface resilience.', confidence: 0.9 };
  const valid = existingChanges.find(c => c.edit.operation === 'skill_reorder' || c.edit.operation === 'bullet_reorder');
  assert.ok(valid);
  const provider = {
    suggestEdits: async () => ({ suggested_changes: [rewrite, { ...valid.edit, reason: valid.reason, jdKeyword: valid.jdKeyword, confidence: valid.confidence }] }),
    reviewEdits: async () => { throw Object.assign(Error('timeout'), { code: 'TIMEOUT' }); }
  };
  const result = await refineResume({ ...input, provider });
  assert.equal(result.diagnostics.stage, 'factual_review');
  assert.match(result.warning, /Unreviewed rewrites were withheld/);
  assert.ok(result.changes.length);
  assert.ok(!result.changes.some(c => c.edit.operation === 'bullet_rewrite'));
  assert.equal(result.replaced, true);
});

test('malformed edit structures and valid-but-empty edits have different diagnostics', async () => {
  const invalid = await refineResume({ ...input, provider: { suggestEdits: async () => ({ unrelated: [] }) } });
  assert.equal(invalid.diagnostics.code, 'INVALID_STRUCTURE');
  const empty = await refineResume({ ...input, provider: { suggestEdits: async () => ({ suggested_changes: [] }) } });
  assert.equal(empty.diagnostics.code, 'OK');
  assert.match(empty.warning, /no edits that passed validation/);
});

test('provider reports invalid/truncated/empty responses and accepts a fenced JSON object', async () => {
  const provider = content => createKymaProvider({ apiKey: 'test-key', model: 'deepseek-v4.1-flash', fetchImpl: async () => success(content) });
  assert.deepEqual(await provider('```json\n{"suggested_changes":[]}\n```').suggestEdits({}), { suggested_changes: [] });
  await assert.rejects(provider('{bad').suggestEdits({}), e => e.code === 'INVALID_JSON');
  await assert.rejects(provider('').suggestEdits({}), e => e.code === 'EMPTY_CONTENT');
  const truncated = createKymaProvider({ apiKey: 'test-key', fetchImpl: async () => ({ ok: true, json: async () => ({ choices: [{ finish_reason: 'length', message: { content: '{}' } }] }) }) });
  await assert.rejects(truncated.suggestEdits({}), e => e.code === 'TRUNCATED_RESPONSE');
  assert.equal(provider('{}').label, 'Kyma · deepseek-v4.1-flash');
});

test('provider distinguishes API rejection, timeout, and network failure', async () => {
  const rejected = createKymaProvider({ apiKey: 'test-key', fetchImpl: async () => ({ ok: false, status: 429, json: async () => ({ error: { message: 'private body test-key' } }) }) });
  await assert.rejects(rejected.suggestEdits({}), e => e.code === 'HTTP_ERROR' && e.status === 429 && !e.message.includes('test-key'));
  const timedOut = createKymaProvider({ apiKey: 'test-key', fetchImpl: async () => { throw Object.assign(Error('request aborted'), { name: 'TimeoutError' }); } });
  await assert.rejects(timedOut.suggestEdits({}), e => e.code === 'TIMEOUT');
  const offline = createKymaProvider({ apiKey: 'test-key', fetchImpl: async () => { throw Error('network unavailable'); } });
  await assert.rejects(offline.suggestEdits({}), e => e.code === 'NETWORK');
});


test('generation gets grounded outcome-to-implementation opportunities without asserting causal links', () => {
  const { editInput } = prepareRefinement({ jobTitle: 'Infrastructure Engineer', analysis, profile, resume });
  const opportunity = editInput.rewriteOpportunities.find(o => o.targetBulletId === 'dd_gpu');
  assert.ok(opportunity);
  assert.ok(opportunity.possibleSourceBulletIds.includes('dd_ingest'));
  assert.ok(opportunity.possibleSourceBulletIds.includes('dd_gpu'));
  assert.match(opportunity.opportunity, /not proof of causality/);
});

test('a verified tool keyword can reference its compound JD requirement without rejecting the reviewed rewrite', async () => {
  const keyword = 'Python/Django or Go or similar backend technologies';
  const a = analyzeMatches(keyword, { requirements: [{ keyword, source: keyword, category: 'required_technical_skill', priority: 'critical' }] }, profile, resumes);
  const raw = { operation: 'bullet_rewrite', section: 'experience', targetId: 'datadog_2026', itemId: 'dd_gpu', sourceBulletIds: ['dd_gpu'], proposed: 'Replaced per-cloud manual capacity audits with a fleet-wide view for 3,000+ engineers, surfacing $100,000+ in underutilized GPU reservations to AI Platform teams.', jdKeyword: 'Go', reason: 'Lead with the operational result while retaining the opportunity and scale.', confidence: 0.9 };
  const provider = {
    suggestEdits: async () => ({ suggested_changes: [raw] }),
    reviewEdits: async ({ candidates }) => ({ reviews: candidates.map(c => ({ id: c.id, supported: true, improves: true, unsupportedClaims: [], reason: 'Preserves the verified results with a distinct impact-first framing.' })) })
  };
  const result = await refineResume({ provider, input: {}, analysis: a, profile, resume, existingChanges: [] });
  assert.equal(result.changes.length, 1);
  assert.equal(result.changes[0].jdKeyword, keyword);
  assert.equal(result.changes[0].edit.operation, 'bullet_rewrite');
  const unsupported = await refineResume({ provider: { ...provider, suggestEdits: async () => ({ suggested_changes: [{ ...raw, jdKeyword: 'Terraform' }] }) }, input: {}, analysis: a, profile, resume, existingChanges: [] });
  assert.equal(unsupported.changes.length, 0);
});

test('DeepSeek uses its native thinking switch while preserving JSON output mode', async () => {
  const provider = createKymaProvider({ apiKey: 'test-key', model: 'deepseek-v4.1-flash', fetchImpl: async (_url, options) => {
    const body = JSON.parse(options.body);
    assert.deepEqual(body.thinking, { type: 'disabled' });
    assert.ok(!Object.hasOwn(body, 'enable_thinking'));
    assert.deepEqual(body.response_format, { type: 'json_object' });
    return success('{"suggested_changes":[]}');
  } });
  await provider.suggestEdits({});
});

test('400 diagnostics retain safe provider codes and request IDs without echoing upstream messages', async () => {
  let calls = 0;
  const provider = createKymaProvider({ apiKey: 'test-key', fetchImpl: async () => {
    calls++;
    return { ok: false, status: 400, json: async () => ({ error: { code: 'request_rejected', request_id: 'req_123456789', message: 'test-key PRIVATE RESUME CONTENT', param: 'max_tokens' } }) };
  } });
  const result = await refineResume({ ...input, provider });
  assert.equal(calls, 1); // Do not retry an unchanged invalid request.
  assert.equal(result.diagnostics.provider_code, 'request_rejected');
  assert.equal(result.diagnostics.request_id, 'req_123456789');
  assert.match(result.warning, /req_123456789/);
  assert.doesNotMatch(JSON.stringify(result), /test-key|PRIVATE RESUME CONTENT/);
  assert.equal(result.changes, existingChanges);
  const unsafe = createKymaProvider({ apiKey: 'test-key', fetchImpl: async () => ({ ok: false, status: 400, json: async () => ({ error: { code: 'PRIVATE RESUME', request_id: 'not an ID: private content', param: 'private content' } }) }) });
  await assert.rejects(unsafe.suggestEdits({}), e => !e.message.includes('PRIVATE') && !e.message.includes('private content') && e.requestId === undefined && e.providerCode === undefined);
});

test('analysis has its own configurable bounded timeout without changing refinement or audit budgets', async () => {
  for (const [configured, expected] of [[undefined, 90000], [120000, 120000], [900000, 180000], ['bad', 90000], [0, 90000], [-100, 90000]]) {
    const seen = [];
    const provider = createKymaProvider({ apiKey: 'test-key', analysisTimeoutMs: configured, timeoutSignal: ms => { seen.push(ms); return AbortSignal.timeout(ms); }, fetchImpl: async () => success('{}') });
    await provider.analyzeJD({ jobDescription: 'Synthetic distributed robotics position.' });
    await provider.suggestEdits({});
    await provider.reviewEdits({ candidates: [] });
    assert.deepEqual(seen, [expected, 60000, 30000]);
  }
});

test('analysis timeout reports the actual configured budget and never retries unchanged', async () => {
  let calls = 0;
  const provider = createKymaProvider({ apiKey: 'test-key', analysisTimeoutMs: 120000, fetchImpl: async () => { calls++; throw Object.assign(Error('private input'), { name: 'TimeoutError' }); } });
  await assert.rejects(provider.analyzeJD({}), e => e.code === 'TIMEOUT' && e.timeoutMs === 120000 && /120-second/.test(e.message) && !e.message.includes('private'));
  assert.equal(calls, 1);
});
