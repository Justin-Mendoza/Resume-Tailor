import test from 'node:test';
import assert from 'node:assert/strict';
import { loadData } from '../src/data.js';
import { analyzeResumeCoverage, analyzeMatches, evidenceCatalog } from '../src/matcher.js';
import { buildChange } from '../src/editor.js';
const { profile, resumes } = await loadData();
const row = (keyword, source = keyword, extra = {}) => ({ keyword, source, category: 'engineering_competency', priority: 'high', ...extra });
const assess = (r, resume = resumes.backend_infra) => analyzeResumeCoverage(r.source, { requirements: [r] }, profile, resume);

test('broad infrastructure requirements match real accomplishments without model-provided quotations', () => {
  for (const keyword of ['Cloud infrastructure or backend systems experience', 'Infrastructure automation software development', 'Cloud service architecture and design', 'Observability tools', 'Strong problem solving and troubleshooting skills']) {
    const result = assess(row(keyword));
    assert.equal(result.requirements[0].status, 'equivalent', keyword);
    assert.equal(result.requirements[0].demonstrated, true, keyword);
    assert.ok(result.requirements[0].evidence.length, keyword);
  }
});

test('Datadog metrics directly demonstrate observability when Datadog/Prometheus/OpenTelemetry are examples', () => {
  const source = 'Experience with observability tools such as Datadog, prometheus or opentelemetry is preferred';
  const bullet = evidenceCatalog(profile, resumes.backend_infra).find(b => b.id.endsWith('dd_ingest'));
  const result = assess(row('Observability tools', source, { evidence: [{ bulletId: bullet.id, quote: bullet.originalText, match: 'related', reason: 'The bullet demonstrates hands-on use of a named observability tool.' }] }));
  assert.equal(result.requirements[0].status, 'equivalent');
  assert.equal(result.requirements[0].demonstrated, true);
  assert.ok(result.requirements[0].evidence.some(b => b.id === bullet.id));
  assert.equal(result.report.weighted_coverage.percent, 100);
});

test('VPC design establishes cloud architecture contribution without identical JD phrasing', () => {
  const resume = { ...resumes.backend_infra, experience: [], projects: [{ entryId: 'vpc', nameVariant: 0, techSkillIds: ['aws_ec2', 'vpc_tech', 's3'], bulletIds: ['vpc_subnets', 'vpc_peering'] }] };
  const result = assess(row('Contribute to architecture and design of cloud services'), resume);
  assert.equal(result.requirements[0].status, 'equivalent');
  assert.ok(result.requirements[0].evidence.some(b => b.id.endsWith('vpc_subnets')));
});

test('specific tools, years, scale and bundled telemetry remain unproven despite broad related evidence', () => {
  for (const keyword of ['Cloud infrastructure experience (1+ years)', 'Infrastructure automation with Terraform', 'Production cloud service architecture', 'Multi-region cloud infrastructure', 'Monitoring, alerting, and logging systems']) {
    const result = assess(row(keyword));
    assert.equal(result.requirements[0].status, 'related', keyword);
    assert.equal(result.requirements[0].demonstrated, false, keyword);
    assert.equal(result.report.weighted_coverage.demonstrated_weight, 0, keyword);
  }
  for (const keyword of ['Terraform', 'Service mesh', 'Open source contributions']) {
    assert.equal(assess(row(keyword)).requirements[0].status, 'unsupported', keyword);
  }
});

test('skills, employer names, and unrelated experience do not establish hands-on competencies', () => {
  const resume = { ...resumes.backend_infra, experience: [], projects: [] };
  for (const keyword of ['Cloud infrastructure experience', 'Observability tools']) assert.equal(assess(row(keyword), resume).requirements[0].status, 'unsupported');
  const p = structuredClone(profile);
  p.experience[0].bullets = [{ id: 'unrelated', text: 'Organized team lunches.', skillIds: [] }];
  const selected = { ...resume, experience: [{ entryId: 'datadog_2026', titleVariant: 0, bulletIds: ['unrelated'] }] };
  assert.equal(analyzeResumeCoverage('Observability tools', { requirements: [row('Observability tools')] }, p, selected).requirements[0].status, 'unsupported');
});

test('onsite preferences are confirmations rather than technical deficiencies or coverage penalties', () => {
  const r = row('Onsite work at San Mateo HQ', undefined, { category: 'other_qualification', priority: 'high' });
  r.source = r.keyword;
  const { requirements, report } = assess(r);
  assert.equal(requirements[0].requires_confirmation, true);
  assert.equal(report.candidate_confirmations[0].keyword, r.keyword);
  assert.equal(report.weighted_coverage.total_weight, 0);
  assert.equal(report.weighted_coverage.percent, null);
  assert.deepEqual(report.unsupported_requirements, []);
  const analysis = analyzeMatches(r.source, { requirements: [r] }, profile, resumes);
  assert.ok(!analysis.unsupported_keywords.includes(r.keyword));
  assert.equal(buildChange({ operation: 'bullet_rewrite', section: 'experience', targetId: 'datadog_2026', itemId: 'dd_gpu', jdKeyword: r.keyword, reason: 'Claim onsite availability', confidence: 1 }, analysis, profile, resumes.backend_infra), null);
});

test('using Datadog does not satisfy a specific Prometheus requirement', () => {
  const result = assess(row('Prometheus observability tools'));
  assert.equal(result.requirements[0].status, 'related');
  assert.equal(result.requirements[0].demonstrated, false);
});

test('cloud/backend experience stays visible when the JD source includes an unverified one-year minimum', () => {
  const result = assess(row('Cloud infrastructure or backend systems experience', '1+ years of experience on cloud infrastructure or backend systems.'));
  const r = result.requirements[0];
  assert.equal(r.status, 'related');
  assert.deepEqual(r.unverified_qualifiers, ['experience_duration']);
  assert.ok(r.evidence.some(e => e.id.endsWith('dd_ingest')));
  assert.equal(r.demonstrated, false);
  assert.equal(result.report.weighted_coverage.demonstrated_weight, 0);
});
