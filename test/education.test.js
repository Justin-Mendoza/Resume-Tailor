import test from 'node:test';
import assert from 'node:assert/strict';
import { loadData } from '../src/data.js';
import { educationCatalog, analyzeResumeCoverage } from '../src/matcher.js';
const { profile, resumes } = await loadData();
const jd = 'Must have a BS, MS, or PhD in Computer Science, or similar technical field of study';
const keyword = "Bachelor's, Master's, or PhD in Computer Science or similar technical field";
const analyze = (p, text = jd, k = keyword, resume = resumes.ai_search_ml) => analyzeResumeCoverage(text, { requirements: [{ keyword: k, source: text, category: 'other_qualification', priority: 'critical' }] }, p, resume);
const pendingProfile = () => { const p = structuredClone(profile); p.education[0].dates = 'Sept. 2023 – Dec. 2099'; return p; };
const completedProfile = () => { const p = structuredClone(profile); p.education[0].dates = 'Sept. 2020 – Dec. 2024'; return p; };

test('reproduced prerequisite recognizes degree evidence and flags expected graduation rather than no evidence', () => {
  const { requirements, report } = analyze(pendingProfile());
  const r = requirements[0];
  assert.equal(r.status, 'related');
  assert.equal(r.evidence_basis, 'education_record');
  assert.equal(r.evidence[0].degree, 'Bachelor of Computer Science');
  assert.equal(r.evidence[0].completion_status, 'in_progress');
  assert.match(r.evidence[0].rationale, /not claim a completed degree/);
  assert.equal(r.demonstrated, false);
  assert.deepEqual(report.unsupported_requirements, []);
  assert.deepEqual(report.related_requirements, [keyword]);
  assert.equal(report.weighted_coverage.demonstrated_weight, 0);
});

test('completed Bachelor of Computer Science meets BS/MS/PhD alternatives and earns education credit', () => {
  const { requirements, report } = analyze(completedProfile());
  assert.equal(requirements[0].status, 'equivalent');
  assert.equal(requirements[0].demonstrated, true);
  assert.equal(report.weighted_coverage.demonstrated_weight, 5);
  assert.deepEqual(report.critical_demonstrated, [keyword]);
  assert.deepEqual(report.presentation_gaps, []);
});

test('pursuing degree is credited only where the job explicitly accepts it', () => {
  const result = analyze(pendingProfile(), 'Currently pursuing a BS in Computer Science', "Pursuing a bachelor's degree in Computer Science");
  assert.equal(result.requirements[0].status, 'equivalent');
  assert.equal(result.report.weighted_coverage.demonstrated_weight, 5);
});

test('BS, BSc, B.S., and bachelor degree terminology match without inventing advanced degrees', () => {
  for (const k of ['BS in Computer Science', 'BSc in Computer Science', 'B.S. in CS', "Bachelor's degree in Computer Science"]) {
    assert.equal(analyze(completedProfile(), k, k).requirements[0].status, 'equivalent', k);
  }
  for (const k of ['MS in Computer Science', 'PhD in Computer Science', "Bachelor's in Biology", "Bachelor's in Marine Biology", "Bachelor's and Master's in Computer Science"]) {
    assert.equal(analyze(completedProfile(), k, k).requirements[0].status, 'unsupported', k);
  }
});

test('unverified completion and additional qualifiers remain uncredited', () => {
  const p = completedProfile();
  p.education[0].dates = 'Completion date not provided';
  assert.equal(analyze(p).requirements[0].status, 'related');
  const text = 'BS in Computer Science with GPA 3.5';
  assert.equal(analyze(completedProfile(), text, text).requirements[0].status, 'related');
});

test('education evidence follows resume selection and never uses course lists as earned degrees', () => {
  const resume = { ...resumes.ai_search_ml, education: [] };
  assert.equal(analyze(completedProfile(), jd, keyword, resume).requirements[0].status, 'unsupported');
  const p = completedProfile();
  p.education[0].degree = 'Bachelor of Biology';
  p.education[0].details = ['Courses: Computer Science'];
  assert.equal(analyze(p).requirements[0].status, 'unsupported');
});

test('education dates are interpreted relative to the analysis date, not a hardcoded graduation year', () => {
  const evidence = educationCatalog(profile, resumes.ai_search_ml, new Date('2026-10-15T12:00:00Z'));
  assert.equal(evidence[0].completion_status, 'in_progress');
  assert.equal(educationCatalog(profile, resumes.ai_search_ml, new Date('2027-01-15T12:00:00Z'))[0].completion_status, 'completed');
});
