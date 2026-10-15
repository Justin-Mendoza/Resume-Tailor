import test from 'node:test';
import assert from 'node:assert/strict';
import { loadData } from '../src/data.js';
import { analyzeMatches, analyzeResumeCoverage, displayedText } from '../src/matcher.js';
import { prepareRefinement } from '../src/refinement.js';
const { profile, resumes } = await loadData();

test('current PDF versions retain their specific project selections, order and source fingerprints', () => {
  const expected = {
    general_swe: ['Justin_Mendoza.pdf', ['search', 'jobwatch', 'resume_tailor']],
    ai_search_ml: ['Justin_Mendoza_AI_Infra.pdf', ['search', 'resume_tailor', 'jobwatch']],
    backend_infra: ['Justin_Mendoza_Infra.pdf', ['jobwatch', 'search', 'video']]
  };
  for (const [id, [filename, projects]] of Object.entries(expected)) {
    assert.equal(resumes[id].sourceDocument.filename, filename);
    assert.match(resumes[id].sourceDocument.sha256, /^[0-9a-f]{64}$/);
    assert.deepEqual(resumes[id].projects.map(p => p.entryId), projects);
    const text = displayedText(profile, resumes[id]);
    for (const term of ['83 company ATS APIs', 'every 3 minutes', '12,000 postings per cycle', 'GitHub Actions', 'Fly.io', '$2/month']) assert.ok(text.includes(term), `${id}: ${term}`);
    assert.ok(!text.includes('for4 $2'));
  }
  assert.equal(profile.identity.links[0], 'linkedin.com/in/777ustin');
  assert.equal(profile.identity.linkUrls[0], 'https://www.linkedin.com/in/777ustin/');
  assert.equal(profile.projects.find(p => p.id === 'jobwatch').url, 'https://github.com/Justin-Mendoza/job_Bot');
});

test('JobWatch evidence reaches requirement analysis and rewrite inputs without inventing preferred tools', () => {
  const requirements = ['Go', 'Docker', 'GitHub Actions', 'Fly.io', 'Kubernetes', 'Terraform'].map(keyword => ({ keyword, source: keyword, category: 'required_technical_skill', priority: 'critical' }));
  const analysis = analyzeMatches(requirements.map(r => r.keyword).join(' '), { recommended_resume: 'backend_infra', requirements }, profile, resumes);
  assert.ok(analysis.requirements.find(r => r.keyword === 'Go').evidence.some(e => e.id.endsWith('jw_polling')));
  assert.ok(analysis.requirements.find(r => r.keyword === 'Docker').evidence.some(e => e.id.endsWith('jw_reliability')));
  assert.ok(analysis.unsupported_keywords.includes('Terraform'));
  const { editInput } = prepareRefinement({ jobTitle: 'Infrastructure Engineer', analysis, profile, resume: resumes.backend_infra });
  const entry = editInput.selectedResume.entries.find(e => e.entryId === 'jobwatch');
  assert.ok(entry.relevantBullets.some(b => b.currentText.includes('persistent state')));
  const isolated = { ...resumes.backend_infra, experience: [], projects: resumes.backend_infra.projects.filter(p => p.entryId === 'jobwatch') };
  const coverage = analyzeResumeCoverage('Kubernetes', { requirements: requirements.filter(r => r.keyword === 'Kubernetes') }, profile, isolated);
  assert.equal(coverage.requirements[0].demonstrated, false);
});
