import test from 'node:test';
import assert from 'node:assert/strict';
import { loadData, isConfigured } from '../src/data.js';
import { analyzeMatches } from '../src/matcher.js';

const { profile, resumes } = await loadData();

test('three verified resume selections load without unknown references', () => {
  assert.equal(isConfigured(profile, resumes), true);
  assert.equal(Object.keys(resumes).length, 3);
  assert.equal(profile.experience.length, 2);
  assert.equal(profile.projects.length, 3);
});

test('keyword comparison separates present, verified missing, and unsupported terms', () => {
  const jd = 'We need RAG, Hybrid Search, Node.js, and Ruby on Rails for a search engineering position.';
  const analysis = analyzeMatches(jd, { recommended_resume: 'ai_search_ml', job_category: 'search_engineering', important_keywords: ['RAG', 'Hybrid Search', 'Node.js', 'Ruby on Rails'] }, profile, resumes);
  assert.equal(analysis.recommended_resume, 'ai_search_ml');
  assert.ok(analysis.matched_keywords.includes('RAG'));
  assert.ok(analysis.missing_but_verified.includes('Node.js'));
  assert.deepEqual(analysis.unsupported_keywords, ['Ruby on Rails']);
});
