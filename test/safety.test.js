import test from 'node:test';
import assert from 'node:assert/strict';
import { loadData } from '../src/data.js';
import { analyzeMatches, containsTerm } from '../src/matcher.js';
import { buildChange, validateSuggestions, fallbackSuggestions, combineSuggestions, applyApproved } from '../src/editor.js';
import { renderLatex, escapeLatex } from '../src/latex.js';
import { outputFilename } from '../src/compiler.js';
import { createKymaProvider } from '../src/providers/kyma.js';
import { targetRoleFor } from '../src/role.js';

const { profile, resumes } = await loadData();

test('all three transcribed resumes load and render from verified content', async () => {
  for (const resume of Object.values(resumes)) {
    const tex = await renderLatex(profile, resume);
    assert.match(tex, /Justin Mendoza/);
    assert.match(tex, /100,000\+/);
    assert.doesNotMatch(tex, /%%RESUME_CONTENT%%/);
  }
});

test('updated General and AI resumes include the verified Resume Tailor project while Infrastructure keeps VPC', async () => {
  for (const id of ['general_swe', 'ai_search_ml']) {
    const resume = resumes[id];
    assert.ok(resume.projects.some(project => project.entryId === 'resume_tailor'));
    assert.ok(!resume.projects.some(project => project.entryId === 'vpc'));
    const tex = await renderLatex(profile, resume);
    assert.match(tex, /Resume Tailor/);
    assert.match(tex, /Qwen API, LaTeX, JSON Schema/);
    assert.match(tex, /JSON Schema validation/);
  }
  assert.ok(resumes.backend_infra.projects.some(project => project.entryId === 'vpc'));
  assert.ok(!resumes.backend_infra.projects.some(project => project.entryId === 'resume_tailor'));
});

test('unsupported JD keyword cannot become a resume edit', () => {
  const jd = 'We need Python and Ruby on Rails for this backend software engineering role.';
  const analysis = analyzeMatches(jd, { recommended_resume: 'general_swe', job_category: 'backend_swe', important_keywords: ['Python', 'Ruby on Rails'] }, profile, resumes);
  assert.deepEqual(analysis.unsupported_keywords, ['Ruby on Rails']);
  const edit = { operation: 'skill_add', section: 'skills', targetId: 'Backend & Data', itemId: 'ruby', order: [], variantIndex: 0, reason: 'JD asks for Rails', jdKeyword: 'Ruby on Rails', confidence: 0.9 };
  assert.equal(buildChange(edit, analysis, profile, resumes[analysis.recommended_resume]), null);
});

test('only exact verified variants and valid reorder permutations survive', () => {
  const jd = 'Kubernetes, Go, and AWS are required for infrastructure engineering.';
  const analysis = analyzeMatches(jd, { recommended_resume: 'backend_infra', job_category: 'infrastructure', important_keywords: ['Kubernetes', 'Go', 'AWS'] }, profile, resumes);
  const valid = { operation: 'skill_reorder', section: 'skills', targetId: 'Infrastructure', itemId: '', order: ['aws', 'kubernetes', 'docker', ...resumes.backend_infra.skillGroups[1].skillIds.slice(3)], variantIndex: 0, reason: 'Bring AWS first', jdKeyword: 'AWS', confidence: 0.7 };
  const invalid = { ...valid, order: ['new_technology'] };
  assert.equal(validateSuggestions([invalid], analysis, profile, resumes.backend_infra).length, 0);
  const change = validateSuggestions([valid], analysis, profile, resumes.backend_infra);
  assert.equal(change.length, 1);
  const tailored = applyApproved(resumes.backend_infra, change, [change[0].id]);
  assert.equal(tailored.skillGroups[1].skillIds[0], 'aws');
  assert.equal(resumes.backend_infra.skillGroups[1].skillIds[0], 'kubernetes');
  assert.throws(() => applyApproved(resumes.backend_infra, change, ['invented_edit']));
});

test('irrelevant reorders are rejected even when they are valid permutations', () => {
  const jd = 'Go and Kubernetes are required for infrastructure engineering.';
  const analysis = analyzeMatches(jd, { recommended_resume: 'backend_infra', job_category: 'infrastructure', important_keywords: ['Go', 'Kubernetes'] }, profile, resumes);
  const group = resumes.backend_infra.skillGroups[0];
  const proposal = { operation: 'skill_reorder', section: 'skills', targetId: 'Languages', itemId: '', order: [group.skillIds[0], group.skillIds[2], group.skillIds[1], ...group.skillIds.slice(3)], variantIndex: 0, reason: 'Go is important', jdKeyword: 'Go', confidence: 0.8 };
  assert.equal(buildChange(proposal, analysis, profile, resumes.backend_infra), null);
});

test('renderer escapes special characters and filenames stay plain', () => {
  assert.equal(escapeLatex('$100,000 & 20%'), '\\$100,000 \\& 20\\%');
  assert.equal(outputFilename('Justin Mendoza', 'Cohere / Inc.', 'Software Engineer'), 'Justin_Mendoza_Cohere_Inc_Software_Engineer.pdf');
});

test('renderer uses the structured Overleaf layout and only bolds verified emphasis spans', async () => {
  const tex = await renderLatex(profile, resumes.general_swe);
  assert.ok(tex.includes('\\resumeSubheading{Datadog}{New York, NY}'));
  assert.ok(tex.includes('\\resumeProject{Enterprise Search Engine'));
  assert.ok(tex.includes('\\textbf{\\$100,000+}'));
  assert.ok(tex.includes('\\textbf{3,000+ engineers}'));
  assert.ok(tex.includes('\\textbf{chargeback signal}'));
  assert.ok(tex.includes('\\resumeSkill{Backend \\& Data}'));
});

test('new bullet wording from the model is never accepted', () => {
  const jd = 'We need Kubernetes and Go for this infrastructure role.';
  const analysis = analyzeMatches(jd, { recommended_resume: 'backend_infra', job_category: 'infrastructure', important_keywords: ['Kubernetes', 'Go'] }, profile, resumes);
  const proposed = { operation: 'bullet_variant', section: 'experience', targetId: 'datadog_2026', itemId: 'dd_ingest', order: [], variantIndex: 999, reason: 'Use fabricated wording', jdKeyword: 'Kubernetes', confidence: 0.9 };
  assert.equal(buildChange(proposed, analysis, profile, resumes.backend_infra), null);
});

test('local suggestions provide several verified, relevant edits without Qwen refinement', () => {
  const jd = 'We need Python, PostgreSQL, Kubernetes, Go, AWS, Kafka, and REST APIs for backend infrastructure.';
  const analysis = analyzeMatches(jd, { recommended_resume: 'general_swe', job_category: 'backend', important_keywords: ['Python', 'PostgreSQL', 'Kubernetes', 'Go', 'AWS', 'Kafka', 'REST APIs'] }, profile, resumes);
  const changes = fallbackSuggestions(analysis, profile, resumes[analysis.recommended_resume]);
  assert.ok(changes.length >= 2 && changes.length <= 5);
  assert.ok(changes.some(change => change.edit.operation === 'bullet_variant'));
  assert.ok(changes.every(change => analysis.important_keywords.includes(change.jdKeyword)));
  assert.ok(changes.every(change => buildChange({ ...change.edit, reason: change.reason, jdKeyword: change.jdKeyword, confidence: change.confidence }, analysis, profile, resumes[analysis.recommended_resume])));
});

test('ATS suggestions add a verified skill to Skills even when it appears only in a project', () => {
  const tailoredBase = structuredClone(resumes.general_swe);
  tailoredBase.skillGroups.find(group => group.label === 'Backend & Data').skillIds = tailoredBase.skillGroups.find(group => group.label === 'Backend & Data').skillIds.filter(id => id !== 'opensearch');
  const selected = { ...resumes, general_swe: tailoredBase };
  const analysis = analyzeMatches('OpenSearch is a core requirement for this backend software engineering role.', { recommended_resume: 'general_swe', job_category: 'backend_swe', important_keywords: ['OpenSearch'] }, profile, selected);
  assert.ok(analysis.matched_keywords.includes('OpenSearch'));
  assert.ok(analysis.missing_from_skills.includes('OpenSearch'));
  const changes = fallbackSuggestions(analysis, profile, tailoredBase);
  const add = changes.find(change => change.edit.operation === 'skill_add' && change.edit.itemId === 'opensearch');
  assert.ok(add);
  const approved = applyApproved(tailoredBase, [add], [add.id]);
  assert.ok(approved.skillGroups.find(group => group.label === 'Backend & Data').skillIds.includes('opensearch'));
});

test('ATS suggestions can move an existing relevant project before unrelated projects', () => {
  const analysis = analyzeMatches('Kafka is central to this software engineering role.', { recommended_resume: 'general_swe', job_category: 'software_engineering', important_keywords: ['Kafka'] }, profile, resumes);
  const changes = fallbackSuggestions(analysis, profile, resumes.general_swe);
  const reorder = changes.find(change => change.edit.operation === 'project_reorder');
  assert.ok(reorder);
  const tailored = applyApproved(resumes.general_swe, [reorder], [reorder.id]);
  assert.equal(tailored.projects[0].entryId, 'video');
  assert.equal(resumes.general_swe.projects[0].entryId, 'search');
});

test('project reorder validation rejects invented IDs and changes unrelated to the cited keyword', () => {
  const analysis = analyzeMatches('Kafka is central to this software engineering role.', { recommended_resume: 'general_swe', job_category: 'software_engineering', important_keywords: ['Kafka'] }, profile, resumes);
  const base = { operation: 'project_reorder', section: 'projects', targetId: 'projects', itemId: '', variantIndex: 0, reason: 'Put relevant work first', jdKeyword: 'Kafka', confidence: 0.8 };
  assert.equal(buildChange({ ...base, order: ['invented_project', 'search', 'resume_tailor'] }, analysis, profile, resumes.general_swe), null);
  assert.equal(buildChange({ ...base, order: ['resume_tailor', 'search', 'video'] }, analysis, profile, resumes.general_swe), null);
});

test('Qwen reorder-only output cannot displace stronger verified edits', () => {
  const analysis = analyzeMatches('Kubernetes and Python are required for backend infrastructure.', { recommended_resume: 'general_swe', job_category: 'backend', important_keywords: ['Kubernetes', 'Python'] }, profile, resumes);
  const local = fallbackSuggestions(analysis, profile, resumes.general_swe);
  const variant = local.find(change => change.edit.operation === 'bullet_variant');
  assert.ok(variant);
  const group = resumes.general_swe.skillGroups.find(item => item.label === 'Languages');
  const reorder = validateSuggestions([{ operation: 'skill_reorder', section: 'skills', targetId: group.label, itemId: '', order: ['python', ...group.skillIds.filter(id => id !== 'python')], variantIndex: 0, reason: 'Surface Python first', jdKeyword: 'Python', confidence: 0.8 }], analysis, profile, resumes.general_swe);
  assert.equal(reorder.length, 1);
  const combined = combineSuggestions(reorder, local);
  assert.ok(combined.some(change => change.edit.operation === 'bullet_variant'));
  assert.ok(combined.some(change => change.edit.operation === 'skill_reorder'));
  assert.ok(combined.length <= 5);
  assert.equal(new Set(combined.map(change => change.conflictKey)).size, combined.length);
  assert.deepEqual(combined.map(change => change.id), combined.map((_, index) => `change_${index + 1}`));
});

test('verified project wording can surface exact JD terms without changing the underlying claims', async () => {
  for (const [keyword, entryId, bulletId, skillId] of [
    ['Hybrid Search', 'search', 'search_relevance', 'hybrid_search'],
    ['RAG', 'search', 'search_index', 'rag'],
    ['Qwen API', 'resume_tailor', 'rt_pipeline', 'qwen_api']
  ]) {
    const jd = `This software engineering role requires ${keyword} in production projects.`;
    const analysis = analyzeMatches(jd, { recommended_resume: 'ai_search_ml', job_category: 'software_engineering', important_keywords: [keyword] }, profile, resumes);
    const bullet = profile.projects.find(entry => entry.id === entryId).bullets.find(item => item.id === bulletId);
    assert.ok(bullet.skillIds.includes(skillId));
    const change = fallbackSuggestions(analysis, profile, resumes.ai_search_ml)
      .find(item => item.edit.operation === 'bullet_variant' && item.edit.targetId === entryId && item.edit.itemId === bulletId);
    assert.ok(change, `Expected a verified wording option for ${keyword}`);
    assert.ok(!containsTerm(change.original, keyword));
    assert.ok(containsTerm(change.proposed, keyword));
    const tailored = applyApproved(resumes.ai_search_ml, [change], [change.id]);
    const tex = await renderLatex(profile, tailored);
    assert.ok(containsTerm(tex, keyword));
  }
});

test('backend and DevOps postings select only existing Intern title variants', async () => {
  assert.equal(targetRoleFor('Senior Backend Engineer'), 'Backend Engineer');
  assert.equal(targetRoleFor('DevOps Engineer'), 'DevOps Engineer');
  assert.equal(targetRoleFor('Frontend Engineer'), null);
  for (const [title, role, expected] of [
    ['Backend Engineer', 'Backend Engineer', ['datadog_2026', 'intact_2025']],
    ['DevOps Engineer', 'DevOps Engineer', ['intact_2025']]
  ]) {
    const analysis = { ...analyzeMatches(`We need a ${title} with Java and Go experience.`, { recommended_resume: 'backend_infra', job_category: 'backend_swe', important_keywords: ['Java', 'Go'] }, profile, resumes), target_role: role };
    const changes = fallbackSuggestions(analysis, profile, resumes.backend_infra);
    const titles = changes.filter(change => change.edit.operation === 'experience_title_variant');
    assert.deepEqual(titles.map(change => change.edit.targetId), expected);
    assert.ok(titles.every(change => change.proposed.includes('Intern')));
    const tailored = applyApproved(resumes.backend_infra, changes, titles.map(change => change.id));
    const tex = await renderLatex(profile, tailored);
    assert.ok(tex.includes(role));
    assert.ok(tex.includes('May 2026'));
    assert.ok(tex.includes('May 2025'));
  }
});

test('model cannot invent an experience title or remove Intern', () => {
  const analysis = { ...analyzeMatches('Backend Engineer with Java and Go.', { recommended_resume: 'backend_infra', job_category: 'backend_swe', important_keywords: ['Java', 'Go'] }, profile, resumes), target_role: 'Backend Engineer' };
  const proposal = { operation: 'experience_title_variant', section: 'experience', targetId: 'datadog_2026', itemId: '', order: [], variantIndex: 99, reason: 'Match posting', jdKeyword: 'Backend Engineer', confidence: 0.9 };
  assert.equal(buildChange(proposal, analysis, profile, resumes.backend_infra), null);
  assert.equal(buildChange({ ...proposal, variantIndex: 2, jdKeyword: 'DevOps Engineer' }, analysis, profile, resumes.backend_infra), null);
});

test('Kyma adapter sends the documented Qwen model ID and JSON mode', async () => {
  const provider = createKymaProvider({ apiKey: 'test-key', model: 'qwen-3.8-flash', fetchImpl: async (url, options) => {
    assert.equal(url, 'https://kymaapi.com/v1/chat/completions');
    assert.equal(options.headers.Authorization, 'Bearer test-key');
    const body = JSON.parse(options.body);
    assert.equal(body.model, 'qwen3.8-flash');
    assert.equal(body.enable_thinking, false);
    assert.deepEqual(body.response_format, { type: 'json_object' });
    return { ok: true, json: async () => ({ choices: [{ message: { content: '{"recommended_resume":"general_swe","job_category":"software_engineering","important_keywords":["Go"]}' } }] }) };
  } });
  const result = await provider.analyzeJD({ jobDescription: 'Go' });
  assert.deepEqual(result.important_keywords, ['Go']);
});

test('Qwen refinement defaults to 60 seconds and cannot exceed the 120-second maximum', async () => {
  const seenTimeouts = [];
  const fetchImpl = async (_url, options) => {
    return { ok: true, json: async () => ({ choices: [{ message: { content: '{"suggested_changes":[]}' } }] }) };
  };
  const provider = createKymaProvider({
    apiKey: 'test-key',
    refinementTimeoutMs: undefined,
    timeoutSignal: ms => { seenTimeouts.push(ms); return AbortSignal.timeout(ms); },
    fetchImpl
  });
  await provider.suggestEdits({});
  assert.equal(seenTimeouts.pop(), 60_000);

  const cappedProvider = createKymaProvider({
    apiKey: 'test-key',
    refinementTimeoutMs: 180_000,
    timeoutSignal: ms => { seenTimeouts.push(ms); return AbortSignal.timeout(ms); },
    fetchImpl
  });
  await cappedProvider.suggestEdits({});
  assert.equal(seenTimeouts.pop(), 120_000);
});

test('Qwen prompt prioritizes verified skill additions and wording over cosmetic reorders', async () => {
  const provider = createKymaProvider({ apiKey: 'test-key', fetchImpl: async (_url, options) => {
    const body = JSON.parse(options.body);
    const prompt = body.messages[0].content;
    assert.match(prompt, /missingFromSkills/);
    assert.match(prompt, /bullet variant/);
    assert.match(prompt, /safeCandidates/);
    assert.match(prompt, /never as the entire answer/);
    return { ok: true, json: async () => ({ choices: [{ message: { content: '{"suggested_changes":[]}' } }] }) };
  } });
  await provider.suggestEdits({});
});
