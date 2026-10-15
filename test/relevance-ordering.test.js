import test from 'node:test';
import assert from 'node:assert/strict';
import { loadData } from '../src/data.js';
import { analyzeMatches } from '../src/matcher.js';
import { fallbackSuggestions, applyApproved, buildChange } from '../src/editor.js';
import { bulletRelevance, compareRelevance } from '../src/relevance.js';
const { profile, resumes } = await loadData();
const row = (keyword, priority = 'critical', category = 'required_technical_skill') => ({ keyword, source: keyword, priority, category });
const analyze = requirements => analyzeMatches(requirements.map(r => r.source).join('\n'), { requirements, recommended_resume: 'backend_infra' }, profile, resumes);
const requirements = [row('Python/Django or Go or similar backend technologies'), row('Relational databases and transaction-safe design'), row('Backend systems design', 'high', 'core_responsibility'), row('Developer workflows', 'medium', 'core_responsibility')];

test('Robinhood ordering prioritizes PostgreSQL, then Go reliability, and backend skills without changing chronology', () => {
  const analysis = analyze(requirements), resume = resumes.backend_infra;
  const changes = fallbackSuggestions(analysis, profile, resume);
  const tailored = applyApproved(resume, changes, changes.map(c => c.id));
  assert.deepEqual(tailored.projects.map(p => p.entryId), ['search', 'jobwatch', 'video']);
  assert.equal(tailored.projects[0].bulletIds[0], 'search_postgres');
  assert.equal(tailored.projects[0].techSkillIds[0], 'postgresql');
  assert.equal(tailored.experience[0].bulletIds[0], 'dd_ingest');
  assert.deepEqual(tailored.skillGroups.map(g => g.label), ['Languages', 'Backend & Data', 'Infrastructure', 'Spoken']);
  assert.equal(tailored.skillGroups.find(g => g.label === 'Backend & Data').skillIds[0], 'postgresql');
  assert.deepEqual(tailored.experience.map(e => [e.entryId, e.titleVariant]), resume.experience.map(e => [e.entryId, e.titleVariant]));
  assert.deepEqual(tailored.education, resume.education);
  for (const group of tailored.skillGroups) assert.deepEqual([...group.skillIds].sort(), [...resume.skillGroups.find(g => g.label === group.label).skillIds].sort());
});

test('ordering remains approvable, idempotent, and rejects demoting critical evidence', () => {
  const analysis = analyze(requirements), resume = resumes.backend_infra;
  const changes = fallbackSuggestions(analysis, profile, resume);
  assert.deepEqual(applyApproved(resume, changes, []), resume);
  const tailored = applyApproved(resume, changes, changes.map(c => c.id));
  assert.ok(!fallbackSuggestions(analysis, profile, tailored).some(c => /reorder$/.test(c.edit.operation)));
  const groupChange = changes.find(c => c.edit.operation === 'skill_group_reorder');
  assert.ok(groupChange);
  assert.equal(buildChange({ ...groupChange.edit, order: ['Infrastructure', 'Languages', 'Backend & Data', 'Spoken'], reason: groupChange.reason, jdKeyword: groupChange.jdKeyword, confidence: groupChange.confidence }, analysis, profile, resume), null);
  assert.equal(buildChange({ ...groupChange.edit, order: ['Languages', 'Invented', 'Infrastructure', 'Spoken'], reason: groupChange.reason, jdKeyword: groupChange.jdKeyword, confidence: groupChange.confidence }, analysis, profile, resume), null);
});

test('AI and infrastructure postings prioritize their own categories rather than hard-coding backend first', () => {
  for (const [resume, rows, first] of [
    [resumes.ai_search_ml, [row('RAG'), row('Hybrid Search')], 'AI & Search'],
    [resumes.backend_infra, [row('Docker'), row('Kubernetes'), row('AWS')], 'Infrastructure']
  ]) {
    const analysis = analyze(rows);
    const changes = fallbackSuggestions(analysis, profile, resume);
    const tailored = applyApproved(resume, changes, changes.map(c => c.id));
    assert.equal(tailored.skillGroups[1].label, first);
    assert.equal(tailored.skillGroups[0].label, 'Languages');
    assert.equal(tailored.skillGroups.at(-1).label, 'Spoken');
  }
});

test('keyword repetition does not improve ranking and confirmed duration does not rank projects', () => {
  const analysis = analyze(requirements);
  const selection = resumes.backend_infra.projects.find(p => p.entryId === 'jobwatch');
  const before = bulletRelevance('projects', selection, 'jw_polling', analysis, profile, resumes.backend_infra);
  const changed = structuredClone(resumes.backend_infra);
  changed.rewrites = { 'projects:jobwatch:jw_polling': profile.projects.find(p => p.id === 'jobwatch').bullets[0].text + ' Go Go Go.' };
  assert.equal(compareRelevance(before, bulletRelevance('projects', selection, 'jw_polling', analysis, profile, changed)), 0);
  const onlyDuration = analyze([row('6 months of hands-on software engineering experience', 'critical', 'other_qualification')]);
  assert.ok(!fallbackSuggestions(onlyDuration, profile, resumes.backend_infra).some(c => /reorder$/.test(c.edit.operation)));
});
