import test from 'node:test';
import assert from 'node:assert/strict';
import { loadData } from '../src/data.js';
import { analyzeMatches } from '../src/matcher.js';
import { introducesRedundancy, compatibleBulletChanges } from '../src/entry-quality.js';
import { reviewRewrites } from '../src/rewrite-validation.js';
import { validateSuggestions, fallbackSuggestions, applyApproved, combineSuggestions } from '../src/editor.js';
const { profile, resumes } = await loadData();
// Preserve the former VPC selection as a regression fixture for fused bullets.
const resume = structuredClone(resumes.backend_infra);
resume.projects.push({ entryId: 'vpc', nameVariant: 0, techSkillIds: ['aws_ec2', 'vpc_tech', 's3'], bulletIds: ['vpc_subnets', 'vpc_peering'] });
const row = (keyword, priority = 'high', category = 'engineering_competency') => ({ keyword, source: keyword, priority, category });
const requirements = [row('Experience in Python and/or Go', 'critical', 'required_technical_skill'), row('Cloud infrastructure or backend systems experience', 'critical'), row('Experience with a major cloud platform (preferably AWS)', 'critical'), row('Cloud service architecture and design'), row('Observability tools such as Datadog', 'medium', 'preferred_technical_skill'), row('Kubernetes', 'medium', 'preferred_technical_skill')];
const analysis = analyzeMatches(requirements.map(r => r.source).join('\n'), { recommended_resume: 'backend_infra', requirements }, profile, { ...resumes, backend_infra: resume });
const draft = (section, targetId, itemId, sourceBulletIds, proposed) => ({ operation: 'bullet_rewrite', section, targetId, itemId, sourceBulletIds, proposed, jdKeyword: analysis.important_keywords[0], reason: 'Clarify implementation and impact.', confidence: 0.9 });
const fusedGpu = draft('experience', 'datadog_2026', 'dd_gpu', ['dd_gpu', 'dd_ingest'], 'Engineered a Go ingestion layer correlating Datadog metrics against AWS, GCP, and Azure reservation records, surfacing $100,000+ in underutilized GPU reservations to AI Platform teams and replacing per-cloud manual audits with one fleet-wide capacity view for 3,000+ engineers.');
const fusedVpc = draft('projects', 'vpc', 'vpc_subnets', ['vpc_subnets', 'vpc_peering'], 'Architected a segmented AWS VPC with public and private subnets plus VPC peering and gateway endpoints for private S3 access, keeping cross-VPC traffic off the public internet and isolating workloads so a compromised public host cannot reach private resources.');
const approve = { reviewEdits: async ({ candidates }) => ({ reviews: candidates.map(c => ({ id: c.id, supported: true, improves: true, unsupportedClaims: [], reason: 'Verified distinct accomplishment.' })) }) };

test('actual fused Datadog and VPC drafts are withheld before audit even if individually factual', async () => {
  let audited = false;
  const result = await reviewRewrites({ reviewEdits: async () => { audited = true; return {}; } }, [fusedGpu, fusedVpc], analysis, profile, resume);
  assert.equal(audited, false);
  assert.equal(result.reviews.size, 0);
  assert.equal(validateSuggestions([fusedGpu, fusedVpc], analysis, profile, resume, result.reviews).length, 0);
});

test('repeated technologies and existing overlap are allowed; copied mechanisms are caught', () => {
  const a = 'Built Go services on AWS to provision customer environments with retries and failure isolation.';
  const b = 'Built Go services on AWS to aggregate usage and report monthly costs to customers.';
  assert.equal(introducesRedundancy(a, b, a.replace('Built', 'Engineered')), false);
  assert.equal(introducesRedundancy(a, a, a), false);
  const original = profile.experience[0].bullets.find(b => b.id === 'dd_gpu').text;
  const sibling = profile.experience[0].bullets.find(b => b.id === 'dd_ingest').text;
  assert.equal(introducesRedundancy(original, sibling, fusedGpu.proposed), true);
});

test('distinct aggressive outcome rewrite retains metrics and audit receives selected sibling context', async () => {
  const raw = draft('experience', 'datadog_2026', 'dd_gpu', ['dd_gpu'], 'Replaced per-cloud manual capacity audits with a fleet-wide view for 3,000+ engineers, surfacing $100,000+ in underutilized GPU reservations to AI Platform teams.');
  const provider = { reviewEdits: async input => {
    assert.ok(input.candidates[0].siblingBullets.some(b => b.id === 'dd_ingest'));
    assert.ok(!input.candidates[0].sources.some(b => b.id === 'dd_ingest'));
    return approve.reviewEdits(input);
  } };
  const { reviews } = await reviewRewrites(provider, [raw], analysis, profile, resume);
  const changes = validateSuggestions([raw], analysis, profile, resume, reviews);
  assert.equal(changes.length, 1);
  const tailored = applyApproved(resume, changes, [changes[0].id]);
  assert.equal(tailored.rewrites['experience:datadog_2026:dd_gpu'], raw.proposed);
  assert.deepEqual(tailored.experience, resume.experience);
  assert.deepEqual(tailored.education, resume.education);
});

test('whole-job ranking puts infrastructure projects and verified cloud skills first without losing breadth', () => {
  const changes = fallbackSuggestions(analysis, profile, resume);
  const project = changes.find(c => c.edit.operation === 'project_reorder');
  assert.ok(project);
  assert.ok(project.edit.order.indexOf('vpc') < project.edit.order.indexOf('search'));
  assert.ok(project.edit.order.indexOf('video') < project.edit.order.indexOf('search'));
  const skills = changes.find(c => c.edit.section === 'skills' && c.edit.targetId === 'Infrastructure');
  assert.ok(skills);
  assert.equal(skills.edit.order[0], 'aws');
  assert.ok(skills.edit.order.indexOf('datadog') < skills.edit.order.indexOf('docker'));
  assert.deepEqual([...skills.edit.order].sort(), [...resume.skillGroups.find(g => g.label === 'Infrastructure').skillIds].sort());
  const tailored = applyApproved(resume, changes, changes.map(c => c.id));
  assert.deepEqual(tailored.experience.map(e => e.entryId), resume.experience.map(e => e.entryId));
  assert.ok(!fallbackSuggestions(analysis, profile, tailored).some(c => ['project_reorder', 'skill_reorder'].includes(c.edit.operation)));
});

test('independent approved edits and fallback variants cannot combine into duplicate accomplishments', () => {
  const a = { edit: { operation: 'bullet_rewrite', section: 'projects', targetId: 'vpc', itemId: 'vpc_subnets' }, proposed: fusedVpc.proposed, conflictKey: 'a' };
  const b = { edit: { operation: 'bullet_variant', section: 'projects', targetId: 'vpc', itemId: 'vpc_peering' }, proposed: profile.projects.find(e => e.id === 'vpc').bullets[1].text, conflictKey: 'b' };
  assert.equal(compatibleBulletChanges(a, b, profile, resume), false);
  assert.equal(combineSuggestions([a], [b], analysis, profile, resume).length, 1);
});
