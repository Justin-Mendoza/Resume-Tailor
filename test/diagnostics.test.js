import test from 'node:test';
import assert from 'node:assert/strict';
import { loadData } from '../src/data.js';
import { coverageReport, analyzeResumeCoverage, extractRequirements, evidenceCatalog } from '../src/matcher.js';
import { keywordSaturation, jobTitleAlignment, resumeDiagnostics } from '../src/diagnostics.js';
import { validatePdfText } from '../src/pdf-validation.js';

const { profile, resumes } = await loadData();
const base = resumes.general_swe;
const row = (keyword, priority = 'high', category = 'required_technical_skill') => ({ keyword, source: keyword, priority, category });

test('weighted diagnostic uses 5/4/2/1 weights and excludes declarations and related-only evidence', () => {
  const report = coverageReport([
    { keyword: 'Go', priority: 'critical', status: 'exact', demonstrated: true, exact_keyword_present: true },
    { keyword: 'Postgres', priority: 'high', status: 'equivalent', demonstrated: true, exact_keyword_present: false },
    { keyword: 'Python', priority: 'medium', status: 'exact', demonstrated: false, exact_keyword_present: true },
    { keyword: 'Rust', priority: 'low', status: 'related', demonstrated: false, exact_keyword_present: false }
  ]);
  assert.deepEqual(report.weighted_coverage.weights, { critical: 5, high: 4, medium: 2, low: 1 });
  assert.equal(report.weighted_coverage.demonstrated_weight, 9);
  assert.equal(report.weighted_coverage.total_weight, 12);
  assert.equal(report.weighted_coverage.percent, 75);
  assert.equal(report.weighted_coverage.diagnostic_only, true);
  assert.deepEqual(report.critical_demonstrated, ['Go']);
  assert.deepEqual(report.exact_keywords_present, ['Go', 'Python']);
  assert.deepEqual(report.equivalent_keywords_present, ['Postgres']);
  assert.deepEqual(report.unsupported_requirements, ['Rust']);
  assert.ok(report.presentation_gaps.some(g => g.keyword === 'Postgres' && g.kind === 'exact_wording'));
  assert.ok(report.presentation_gaps.some(g => g.keyword === 'Python' && g.kind === 'declaration_only'));
  assert.equal(coverageReport([]).weighted_coverage.percent, null);
});

test('actual skills-only declarations earn no demonstrated coverage or fabricated bullet evidence', () => {
  const resume = structuredClone(base);
  resume.experience = [];
  resume.projects = [];
  const { report } = analyzeResumeCoverage('Go Kubernetes Ruby on Rails', { requirements: [row('Go', 'critical'), row('Kubernetes'), row('Ruby on Rails')] }, profile, resume);
  assert.equal(report.weighted_coverage.demonstrated_weight, 0);
  assert.equal(report.weighted_coverage.total_weight, 13);
  assert.deepEqual(report.critical_not_demonstrated, ['Go']);
  assert.ok(report.presentation_gaps.some(g => g.keyword === 'Go' && g.kind === 'declaration_only'));
  assert.ok(report.unsupported_requirements.includes('Ruby on Rails'));
});

test('exact coverage tracks final rewritten text, keeps truthful aliases, and uses actual JD terminology', () => {
  const extracted = extractRequirements('Postgres', { requirements: [{ ...row('PostgreSQL'), source: 'Postgres' }] }, profile);
  assert.equal(extracted[0].keyword, 'Postgres');
  const raw = { requirements: [row('Golang'), row('Ruby on Rails')] };
  const before = analyzeResumeCoverage('Golang Ruby on Rails', raw, profile, base);
  assert.ok(before.report.equivalent_keywords_present.includes('Golang'));
  assert.ok(!before.report.exact_keywords_present.includes('Golang'));
  const tailored = structuredClone(base);
  const b = evidenceCatalog(profile, base).find(b => b.text.includes('Go'));
  tailored.rewrites = { [b.id]: b.text.replace(/\bGo\b/, 'Golang') };
  const after = analyzeResumeCoverage('Golang Ruby on Rails', raw, profile, tailored);
  assert.ok(after.report.exact_keywords_present.includes('Golang'));
  assert.ok(!after.report.exact_keywords_present.includes('Ruby on Rails'));
  assert.ok(!after.report.presentation_gaps.some(g => g.keyword === 'Golang' && g.kind === 'exact_wording'));
});

test('repetition warnings group aliases locally, while Skills plus Experience and breadth remain legitimate', () => {
  const requirements = [row('Go'), row('Postgres')];
  assert.deepEqual(keywordSaturation(requirements, profile, base).warnings, []);
  const repeated = structuredClone(base);
  repeated.rewrites = { 'experience:datadog_2026:dd_ui': 'Integrated Go with Go libraries in a Go service; Postgres PostgreSQL Postgres.' };
  const result = keywordSaturation(requirements, profile, repeated);
  assert.deepEqual(result.warnings.map(w => [w.keyword, w.occurrences]), [['Go', 3], ['Postgres', 3]]);
  assert.equal(result.diagnostic_only, true);
  const broad = structuredClone(base);
  broad.rewrites = Object.fromEntries(evidenceCatalog(profile, base).map(b => [b.id, 'Integrated Go, Python, Java, Docker, Kubernetes, AWS, Redis, Kafka, and PostgreSQL.']));
  assert.deepEqual(keywordSaturation(profile.skills.map(s => row(s.label)), profile, broad).warnings, []);
  assert.deepEqual(keywordSaturation([row('Go')], profile, { ...base, rewrites: { 'experience:datadog_2026:dd_ui': 'Worked on Google integrations.' } }).warnings, []);
});

test('target-title alignment recognizes role terminology without changing titles or importing seniority', () => {
  const snapshot = structuredClone(base);
  const result = jobTitleAlignment('Senior Software Developer', profile, base);
  assert.equal(result.target_title, 'Senior Software Developer');
  assert.equal(result.exact_title_present, false);
  assert.ok(result.terminology.some(t => t.term === 'Software Engineer' && t.present));
  assert.ok(!result.remaining_gaps.includes('Senior'));
  assert.deepEqual(base, snapshot);
  assert.equal(jobTitleAlignment('', profile, base).exact_title_present, false);
  const aligned = structuredClone(base);
  aligned.rewrites = { 'experience:datadog_2026:dd_ui': 'Engineered backend services.' };
  assert.ok(jobTitleAlignment('Backend Software Engineer', profile, aligned).terminology.find(t => t.term === 'backend').present);
  assert.ok(resumeDiagnostics([], profile, base, 'AI Engineer').job_title_alignment.target_title === 'AI Engineer');
});

// Existing PDF validation already covers these invariants; regress them rather
// than adding a second PDF parser or changing the compiler/template.
function extractedFixture() {
  const chunks = [[profile.identity.name, profile.identity.email, profile.identity.phone, ...profile.identity.links].join(' ')];
  for (const [section, heading] of [['experience', 'Experience'], ['projects', 'Projects']]) {
    chunks.push(heading);
    for (const sel of base[section]) {
      const e = profile[section].find(e => e.id === sel.entryId);
      chunks.push(section === 'experience' ? [e.company, e.dates, e.titleVariants[sel.titleVariant]].join(' ') : e.nameVariants[sel.nameVariant]);
      chunks.push(...evidenceCatalog(profile, { ...base, experience: section === 'experience' ? [sel] : [], projects: section === 'projects' ? [sel] : [] }).map(b => b.text));
    }
  }
  chunks.push('Technical Skills', ...base.skillGroups.flatMap(g => g.skillIds).map(id => profile.skills.find(s => s.id === id).label), ...base.projects.flatMap(p => p.techSkillIds).map(id => profile.skills.find(s => s.id === id).label));
  chunks.push('Education');
  for (const sel of base.education) { const e = profile.education.find(e => e.id === sel.entryId); chunks.push(e.school, e.degree, e.dates, ...e.details); }
  return chunks.join('\n');
}

test('existing PDF checks detect missing dates, official titles, headings, skills, and bullet reading order', () => {
  const text = extractedFixture();
  assert.equal(validatePdfText(text, profile, base).passed, true);
  for (const value of [profile.identity.email, profile.experience[0].dates, profile.experience[0].titleVariants[base.experience[0].titleVariant], 'Technical Skills', 'C++']) {
    assert.equal(validatePdfText(text.split(value).join(''), profile, base).passed, false, value);
  }
  const [first, second] = evidenceCatalog(profile, base);
  const reversed = text.replace(first.text, 'PLACEHOLDER').replace(second.text, first.text).replace('PLACEHOLDER', second.text);
  assert.equal(validatePdfText(reversed, profile, base).passed, false);
});

test('verified but absent skills are presentation gaps rather than invented unsupported technologies', () => {
  const resume = structuredClone(base);
  resume.experience = [];
  resume.projects = [];
  resume.skillGroups = [];
  const { report } = analyzeResumeCoverage('Go Rust', { requirements: [row('Go', 'critical'), row('Rust')] }, profile, resume);
  assert.deepEqual(report.unsupported_requirements, ['Rust']);
  assert.ok(report.presentation_gaps.some(g => g.keyword === 'Go' && g.kind === 'verified_not_present'));
  assert.equal(report.weighted_coverage.demonstrated_weight, 0);
});

test('an evidence-backed implicit competency earns demonstrated credit without an exact keyword', () => {
  const keyword = 'Fault-tolerant system design';
  const { report } = analyzeResumeCoverage(keyword, { requirements: [row(keyword, 'critical', 'engineering_competency')] }, profile, resumes.backend_infra);
  assert.equal(report.weighted_coverage.demonstrated_weight, 5);
  assert.equal(report.weighted_coverage.percent, 100);
  assert.deepEqual(report.critical_demonstrated, [keyword]);
  assert.deepEqual(report.exact_keywords_present, []);
  assert.ok(report.presentation_gaps.some(g => g.keyword === keyword && g.kind === 'exact_wording'));
});

test('final keyword visibility recognizes aliases, separates unsupported requirements, and does not equate JS with TypeScript', async () => {
  const { technicalKeywordVisibility } = await import('../src/diagnostics.js');
  const requirements = [
    { keyword: 'Golang', source: 'Golang' }, { keyword: 'Postgres', source: 'Postgres' },
    { keyword: 'Terraform', source: 'Terraform' }, { keyword: 'JavaScript', source: 'JavaScript' }
  ];
  const selected = { ...resumes.backend_infra, experience: [], projects: [], education: [], skillGroups: [{ label: 'Languages', skillIds: ['go'] }, { label: 'Backend & Data', skillIds: ['postgresql'] }] };
  const visibility = technicalKeywordVisibility(requirements, profile, selected);
  assert.equal(visibility.present, 2);
  assert.equal(visibility.total, 3);
  assert.ok(!visibility.keywords.some(k => k.keyword === 'Terraform'));
  const tsOnly = structuredClone(profile);
  tsOnly.experience[0].bullets = [{ id: 'ts', text: 'Built a TypeScript interface.', skillIds: ['typescript_js'] }];
  const onlyTs = { ...selected, skillGroups: [], experience: [{ entryId: tsOnly.experience[0].id, titleVariant: 0, bulletIds: ['ts'] }] };
  assert.equal(technicalKeywordVisibility([{ keyword: 'JS', source: 'JS' }], tsOnly, onlyTs).present, 0);
});
