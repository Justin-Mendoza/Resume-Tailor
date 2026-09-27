import test from 'node:test';
import assert from 'node:assert/strict';
import { loadData } from '../src/data.js';
import { analyzeMatches } from '../src/matcher.js';
import { buildChange, validateSuggestions, applyApproved } from '../src/editor.js';
import { renderLatex, escapeLatex } from '../src/latex.js';
import { outputFilename } from '../src/compiler.js';
import { createKymaProvider } from '../src/providers/kyma.js';

const { profile, resumes } = await loadData();

test('all three transcribed resumes load and render from verified content', async () => {
  for (const resume of Object.values(resumes)) {
    const tex = await renderLatex(profile, resume);
    assert.match(tex, /Justin Mendoza/);
    assert.match(tex, /100,000\+/);
    assert.doesNotMatch(tex, /%%RESUME_CONTENT%%/);
  }
});

test('unsupported JD keyword cannot become a resume edit', () => {
  const jd = 'We need Python and Ruby on Rails for this backend software engineering role.';
  const analysis = analyzeMatches(jd, { recommended_resume: 'general_swe', job_category: 'backend_swe', important_keywords: ['Python', 'Ruby on Rails'] }, profile, resumes);
  assert.deepEqual(analysis.unsupported_keywords, ['Ruby on Rails']);
  const edit = { operation: 'skill_add', section: 'skills', targetId: 'Backend & Data', itemId: 'ruby', order: [], variantIndex: 0, reason: 'JD asks for Rails', jdKeyword: 'Ruby on Rails', confidence: 0.9 };
  assert.equal(buildChange(edit, analysis, profile, resumes[analysis.recommended_resume]), null);
});

test('only exact verified variants and valid reorder permutations survive', () => {
  const jd = 'Kubernetes and Go are required for infrastructure engineering.';
  const analysis = analyzeMatches(jd, { recommended_resume: 'backend_infra', job_category: 'infrastructure', important_keywords: ['Kubernetes', 'Go'] }, profile, resumes);
  const valid = { operation: 'skill_reorder', section: 'skills', targetId: 'Infrastructure', itemId: '', order: ['docker', 'kubernetes', ...resumes.backend_infra.skillGroups[1].skillIds.slice(2)], variantIndex: 0, reason: 'Bring Docker first', jdKeyword: 'Kubernetes', confidence: 0.7 };
  const invalid = { ...valid, order: ['new_technology'] };
  assert.equal(validateSuggestions([invalid], analysis, profile, resumes.backend_infra).length, 0);
  const change = validateSuggestions([valid], analysis, profile, resumes.backend_infra);
  assert.equal(change.length, 1);
  const tailored = applyApproved(resumes.backend_infra, change, [change[0].id]);
  assert.equal(tailored.skillGroups[1].skillIds[0], 'docker');
  assert.equal(resumes.backend_infra.skillGroups[1].skillIds[0], 'kubernetes');
  assert.throws(() => applyApproved(resumes.backend_infra, change, ['invented_edit']));
});

test('renderer escapes special characters and filenames stay plain', () => {
  assert.equal(escapeLatex('$100,000 & 20%'), '\\$100,000 \\& 20\\%');
  assert.equal(outputFilename('Justin Mendoza', 'Cohere / Inc.', 'Software Engineer'), 'Justin_Mendoza_Cohere_Inc_Software_Engineer.pdf');
});

test('new bullet wording from the model is never accepted', () => {
  const jd = 'We need Kubernetes and Go for this infrastructure role.';
  const analysis = analyzeMatches(jd, { recommended_resume: 'backend_infra', job_category: 'infrastructure', important_keywords: ['Kubernetes', 'Go'] }, profile, resumes);
  const proposed = { operation: 'bullet_variant', section: 'experience', targetId: 'datadog_2026', itemId: 'dd_ingest', order: [], variantIndex: 999, reason: 'Use fabricated wording', jdKeyword: 'Kubernetes', confidence: 0.9 };
  assert.equal(buildChange(proposed, analysis, profile, resumes.backend_infra), null);
});

test('Kyma adapter sends the documented Qwen model ID and JSON mode', async () => {
  const provider = createKymaProvider({ apiKey: 'test-key', model: 'qwen-3.8-flash', fetchImpl: async (url, options) => {
    assert.equal(url, 'https://kymaapi.com/v1/chat/completions');
    assert.equal(options.headers.Authorization, 'Bearer test-key');
    const body = JSON.parse(options.body);
    assert.equal(body.model, 'qwen3.8-flash');
    assert.deepEqual(body.response_format, { type: 'json_object' });
    return { ok: true, json: async () => ({ choices: [{ message: { content: '{"recommended_resume":"general_swe","job_category":"software_engineering","important_keywords":["Go"]}' } }] }) };
  } });
  const result = await provider.analyzeJD({ jobDescription: 'Go' });
  assert.deepEqual(result.important_keywords, ['Go']);
});
