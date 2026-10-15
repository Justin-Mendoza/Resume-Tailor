import test from 'node:test';
import assert from 'node:assert/strict';
import { loadData } from '../src/data.js';
import { analyzeResumeCoverage, extractRequirements } from '../src/matcher.js';
import { workExperienceEvidence } from '../src/work-experience.js';
const { profile, resumes } = await loadData();
const resume = resumes.backend_infra;
const stackOnlyResume = structuredClone(resume);
stackOnlyResume.projects.find(p => p.entryId === 'search').bulletIds = ['search_relevance', 'search_index', 'search_load'];
const row = (keyword, extra = {}) => ({ keyword, source: keyword, category: 'other_qualification', priority: 'critical', ...extra });
const assess = (rows, p = profile, r = resume) => analyzeResumeCoverage(rows.map(r => r.source).join('\n'), { requirements: rows }, p, r);

test('candidate-confirmed non-overlapping internships satisfy Robinhood six-month minimum', () => {
  const result = assess([row('Hands-on software engineering experience (6 months to 2 years)')]);
  const requirement = result.requirements[0];
  assert.equal(requirement.demonstrated, true);
  assert.equal(requirement.status, 'equivalent');
  assert.equal(requirement.experience_duration.verified_months, 8);
  assert.equal(requirement.experience_duration.minimum_months, 6);
  assert.equal(requirement.evidence.length, 2);
  assert.equal(result.report.weighted_coverage.percent, 100);
});

test('month-only estimates, overlapping terms, missing duration, and internship exclusions cannot earn tenure credit', () => {
  const requirement = row('6 months of hands-on software engineering experience');
  for (const change of [p => { delete p.experience[0].verifiedDurationMonths; }, p => { p.experience[1].dates = p.experience[0].dates; }, p => { p.experience[0].verifiedDurationMonths = 100; }, p => { p.experience[0].dates = 'May 2030 – Aug. 2030'; }]) {
    const p = structuredClone(profile); change(p);
    const result = assess([requirement], p);
    assert.equal(result.requirements[0].demonstrated, false);
    assert.ok(result.requirements[0].unverified_qualifiers.includes('experience_duration'));
  }
  assert.equal(assess([row('1+ years of hands-on software engineering experience')]).requirements[0].demonstrated, false);
  assert.equal(assess([row('6 months of hands-on software engineering experience excluding internships')]).requirements[0].demonstrated, false);
  assert.equal(assess([row('6 months of production hands-on software engineering experience')]).requirements[0].demonstrated, false);
  assert.equal(workExperienceEvidence(row('6 months of Python experience'), profile, resume), null);
});

test('mixed units and same-unit ranges retain the minimum rather than treating two years as required', () => {
  for (const keyword of ['6 Months - 2 Years of Hands-on software engineering experience through previous roles', '0.5–2 years of hands-on software engineering experience']) {
    const requirement = assess([row(keyword)]).requirements[0];
    assert.equal(requirement.experience_duration.minimum_months, 6);
    assert.equal(requirement.status, 'equivalent');
  }
});

test('relational databases are separated from transaction guarantees and project stack evidence stays qualified', () => {
  const result = assess([row('Relational databases and transaction-safe design')], profile, stackOnlyResume);
  assert.equal(result.requirements.length, 2);
  const database = result.requirements.find(r => /relational/i.test(r.keyword));
  const transaction = result.requirements.find(r => /transaction/i.test(r.keyword));
  assert.equal(database.status, 'related');
  assert.ok(database.evidence.some(e => /PostgreSQL/.test(e.text)));
  assert.equal(transaction.status, 'unsupported');
  assert.equal(transaction.demonstrated, false);
  const alternatives = extractRequirements('Relational databases or transaction-safe design', { requirements: [row('Relational databases or transaction-safe design')] }, profile);
  assert.equal(alternatives.length, 1);
});

test('explicit database implementation establishes relational use without proving transaction safety', () => {
  const p = structuredClone(profile);
  p.projects.find(e => e.id === 'search').bullets[0].text = 'Built PostgreSQL queries and schemas to persist document metadata.';
  const result = assess([row('Relational databases and transaction-safe design')], p, stackOnlyResume);
  assert.equal(result.requirements.find(r => /relational/i.test(r.keyword)).demonstrated, true);
  assert.equal(result.requirements.find(r => /transaction/i.test(r.keyword)).demonstrated, false);
});

test('CI/CD tuning establishes developer workflow contribution but does not invent financial integrations or ownership', () => {
  const result = assess(['Contribute to engineering best practices and developer workflows', 'Interface with external financial institutions', 'Own and maintain key production services'].map(k => row(k, { category: 'core_responsibility', priority: 'high' })));
  assert.equal(result.requirements[0].status, 'equivalent');
  assert.ok(result.requirements[0].evidence.some(e => e.id.endsWith('if_cicd')));
  assert.equal(result.requirements[1].demonstrated, false);
  assert.equal(result.requirements[2].demonstrated, false);
});

test('attendance wording is a confirmation regardless of model category and does not lower technical coverage', () => {
  for (const keyword of ['In-person attendance at Menlo Park, CA or New York, NY (3 days/week)', 'In person attendance at headquarters', 'On-site work in San Mateo']) {
    const result = assess([row(keyword, { category: 'core_responsibility' })]);
    assert.equal(result.requirements[0].requires_confirmation, true);
    assert.equal(result.report.weighted_coverage.total_weight, 0);
    assert.equal(result.report.missing_requirements.length, 0);
  }
});

test('an omitted explicit language alternative is recovered from the JD and Go satisfies it without inventing Django', () => {
  const jd = 'Proficiency with Python/Django or Go (or similar backend technologies)';
  const result = analyzeResumeCoverage(jd, { requirements: [] }, profile, resume);
  assert.equal(result.requirements.length, 1);
  assert.equal(result.requirements[0].status, 'equivalent');
  assert.equal(result.requirements[0].demonstrated, true);
  assert.ok(result.requirements[0].evidence.some(e => e.id.endsWith('dd_ingest')));
  const p = structuredClone(profile);
  p.skills = p.skills.filter(s => s.id !== 'go');
  const noGo = { ...resume, experience: [], projects: [], skillGroups: [] };
  assert.equal(analyzeResumeCoverage(jd, { requirements: [] }, p, noGo).requirements[0].demonstrated, false);
});


test('reviewed PostgreSQL implementation demonstrates relational use and narrow transaction-safe design', () => {
  const result = assess([row('Relational databases and transaction-safe design')]);
  for (const r of result.requirements) {
    assert.equal(r.demonstrated, true, r.keyword);
    assert.ok(r.evidence.some(e => e.id.endsWith('search_postgres')), r.keyword);
  }
  const source = profile.projects.find(p => p.id === 'search').bullets.find(b => b.id === 'search_postgres');
  assert.ok(source.sources.some(url => url.includes('/ingestion/checkpoints.py')));
  assert.doesNotMatch(source.text, /financial|production|serializable|banking/i);
});
