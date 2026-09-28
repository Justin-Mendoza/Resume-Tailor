import test from 'node:test';
import assert from 'node:assert/strict';
import { loadData, isConfigured } from '../src/data.js';
import { analyzeMatches } from '../src/matcher.js';

const { profile, resumes } = await loadData();

test('three verified resume selections load without unknown references', () => {
  assert.equal(isConfigured(profile, resumes), true);
  assert.equal(Object.keys(resumes).length, 3);
  assert.equal(profile.experience.length, 2);
  assert.equal(profile.projects.length, 4);
});

test('keyword comparison separates present, verified missing, and unsupported terms', () => {
  const jd = 'We need RAG, Hybrid Search, Node.js, and Ruby on Rails for a search engineering position.';
  const analysis = analyzeMatches(jd, { recommended_resume: 'ai_search_ml', job_category: 'search_engineering', important_keywords: ['RAG', 'Hybrid Search', 'Node.js', 'Ruby on Rails'] }, profile, resumes);
  assert.equal(analysis.recommended_resume, 'ai_search_ml');
  assert.ok(analysis.matched_keywords.includes('RAG'));
  assert.ok(analysis.missing_but_verified.includes('Node.js'));
  assert.deepEqual(analysis.unsupported_keywords, ['Ruby on Rails']);
});

test('keyword matching recognizes exact verified phrases outside the skills list', () => {
  const jd = 'Distributed Systems and JSON Schema are important for this software engineering role.';
  const analysis = analyzeMatches(jd, { recommended_resume: 'general_swe', job_category: 'software_engineering', important_keywords: ['Distributed Systems', 'JSON Schema'] }, profile, resumes);
  assert.ok(analysis.matched_keywords.includes('Distributed Systems'));
  assert.ok(!analysis.unsupported_keywords.includes('Distributed Systems'));
  assert.ok(!analysis.missing_from_skills.includes('JSON Schema'));
});
