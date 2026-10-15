import test from 'node:test';
import assert from 'node:assert/strict';
import { loadData } from '../src/data.js';
import { analyzeResumeCoverage, extractRequirements } from '../src/matcher.js';
import { checkRewrite, rewriteSources } from '../src/rewrite-validation.js';
const { profile, resumes } = await loadData();
const assess = (keyword, resume = resumes.backend_infra) => analyzeResumeCoverage(keyword, { requirements: [{ keyword, source: keyword, category: 'required_technical_skill', priority: 'critical' }] }, profile, resume);

test('wrapped technology requirements canonicalize instead of needing the full phrase in a bullet', () => {
  const result = assess('Experience with Kubernetes');
  assert.equal(result.requirements[0].keyword, 'Kubernetes');
  assert.equal(result.requirements[0].status, 'exact');
  assert.equal(result.requirements[0].demonstrated, true);
  assert.equal(result.report.weighted_coverage.percent, 100);
  const rows = extractRequirements('Experience with Kubernetes and K8s', { requirements: [{ keyword: 'Experience with Kubernetes', source: 'Experience with Kubernetes', category: 'required_technical_skill' }, { keyword: 'K8s', source: 'K8s', category: 'required_technical_skill' }] }, profile);
  assert.equal(rows.length, 1);
});

test('Python and/or Go is satisfied by demonstrated Go regardless of model assessment', () => {
  const result = assess('Experience in Python and/or Go');
  assert.equal(result.requirements[0].status, 'equivalent');
  assert.equal(result.requirements[0].demonstrated, true);
  assert.ok(result.requirements[0].evidence.some(e => e.id.endsWith('dd_ingest')));
  assert.equal(result.report.weighted_coverage.percent, 100);
});

test('OR permits a demonstrated alternative; AND never invents the missing technology', () => {
  const one = assess('Experience in Go or Rust');
  assert.equal(one.requirements[0].status, 'equivalent');
  const all = assess('Experience in Go and Rust');
  assert.equal(all.requirements[0].status, 'related');
  assert.equal(all.requirements[0].demonstrated, false);
  assert.equal(all.report.weighted_coverage.percent, 0);
  assert.equal(assess('Experience with Terraform').requirements[0].status, 'unsupported');
});

test('simple wrapped skills retain distinctions, supporting declarations without inventing hands-on evidence', () => {
  const noWork = { ...resumes.backend_infra, experience: [], projects: [] };
  assert.equal(assess('Experience with Kubernetes', noWork).requirements[0].demonstrated, false);
  assert.equal(assess('Experience with Kubernetes in production').requirements[0].status, 'related');
  assert.equal(assess('3+ years experience in Go or Python').requirements[0].demonstrated, false);
});

test('cosmetic cloud/platform adjective additions do not qualify as aggressive rewrites', () => {
  const sources = rewriteSources(profile, 'experience', 'intact_2025', ['if_onboard']);
  const original = sources[0].text;
  assert.equal(checkRewrite(original, original.replace('onboarding', 'cloud onboarding'), sources, profile, { requirements: [] }), false);
  const rewritten = 'Automated provisioning for 20+ product teams with Java Spring Boot onboarding workflows, eliminating manual setup steps.';
  assert.equal(checkRewrite(original, rewritten, sources, profile, { requirements: [] }), true);
});

test('a model categorization difference does not hide a verified named technology', () => {
  const keyword = 'Experience with Kubernetes';
  const result = analyzeResumeCoverage(keyword, { requirements: [{ keyword, source: keyword, category: 'other_qualification', priority: 'medium' }] }, profile, resumes.general_swe);
  assert.equal(result.requirements[0].status, 'equivalent');
  assert.equal(result.requirements[0].demonstrated, true);
});

test('a generic OR alternative cannot hide an explicitly demonstrated Go alternative', () => {
  for (const keyword of ['Python/Django or Go or similar backend technologies', 'Proficiency with Python/Django or Go (or similar backend technologies)']) {
    const requirement = assess(keyword).requirements[0];
    assert.equal(requirement.status, 'equivalent');
    assert.equal(requirement.demonstrated, true);
    assert.ok(requirement.evidence.some(e => e.id.endsWith('dd_ingest')));
  }
  assert.equal(assess('Go and similar backend technologies').requirements[0].demonstrated, false);
  assert.equal(assess('Go in production or similar backend technologies').requirements[0].demonstrated, false);
});
