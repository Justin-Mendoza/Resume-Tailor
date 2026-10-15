import test from 'node:test';
import assert from 'node:assert/strict';
import { loadData } from '../src/data.js';
import { analyzeResumeCoverage } from '../src/matcher.js';
import { createConnectionNote, generateConnectionNote } from '../src/connection-note.js';
const { profile, resumes } = await loadData();
const requirement = (keyword, priority) => ({ keyword, source: keyword, category: 'required_technical_skill', priority });

test('friendly post-application note uses prioritized demonstrated JD matches and stays within 300 characters', () => {
  const { requirements } = analyzeResumeCoverage('Go Kafka Ruby on Rails', { requirements: [requirement('Go', 'critical'), requirement('Kafka', 'high'), requirement('Ruby on Rails', 'critical')] }, profile, resumes.backend_infra);
  const note = createConnectionNote({ jobTitle: 'Backend Engineer', company: 'Example', requirements, profile });
  assert.ok(note.length <= 300);
  assert.match(note, /Hi! I just applied for the Backend Engineer role at Example/);
  assert.match(note, /Go and Kafka/);
  assert.match(note, /love to connect/);
  assert.doesNotMatch(note, /Ruby|Rails|led|production|savings/);
});

test('skills-only declarations are excluded and no matches produces a friendly factual fallback', () => {
  const note = createConnectionNote({ jobTitle: 'Engineer', company: 'Example', requirements: [{ keyword: 'Python', category: 'required_technical_skill', priority: 'critical', demonstrated: false }], profile });
  assert.ok(note.length <= 300);
  assert.doesNotMatch(note, /experience with Python/);
  assert.match(note, /excited/);
  assert.match(note, /love to connect/);
});

test('long role, employer and technology labels always produce a complete note within the hard limit', () => {
  const requirements = ['Go', 'Kubernetes'].map(keyword => ({ ...requirement(keyword, 'critical'), demonstrated: true }));
  for (const jobTitle of ['Senior '.repeat(30), 'X'.repeat(300), '🚀'.repeat(150)]) {
    const note = createConnectionNote({ jobTitle, company: 'Very Long Company Name '.repeat(20), requirements, profile });
    assert.ok(note.length <= 300, note.length);
    assert.ok(note.endsWith("I'd love to connect!"));
    assert.match(note, /experience with/);
  }
});

test('curated equivalent terms are retained without repeating equivalent skills', () => {
  const requirements = ['Golang', 'Go'].map(keyword => ({ ...requirement(keyword, 'critical'), demonstrated: true }));
  const note = createConnectionNote({ jobTitle: 'Software Engineer', company: 'Example', requirements, profile });
  assert.match(note, /experience with Golang aligns/);
  assert.doesNotMatch(note, /Golang and Go/);
});


const noteInput = {
  jobTitle: 'Backend Engineer', company: 'Example', jobDescription: 'Build Go ingestion services.',
  requirements: analyzeResumeCoverage('Go', { requirements: [requirement('Go', 'critical')] }, profile, resumes.backend_infra).requirements,
  profile, resume: resumes.backend_infra
};
const draft = { note: "Hi! I applied for Backend Engineer at Example. My Go ingestion work at Datadog caught my eye as a fit for your team. I'd love to connect!", evidenceIds: ['experience:datadog_2026:dd_ingest'] };
const noteProvider = (result = draft, supported = true) => ({
  connectionNote: async input => { assert.equal(input.maxCharacters, 300); assert.ok(input.approvedExperience.length); assert.equal(input.jobDescription, noteInput.jobDescription); return result; },
  reviewEdits: async input => { assert.equal(input.contentType, 'linkedin_connection_note'); return { reviews: [{ id: 'connection_note', supported, improves: true, unsupportedClaims: supported ? [] : ['Unverified claim'] }] }; }
});

test('LLM note uses approved evidence and requires independent factual approval', async () => {
  assert.equal(await generateConnectionNote(noteProvider(), noteInput), draft.note);
  assert.equal(await generateConnectionNote(noteProvider(draft, false), noteInput), createConnectionNote(noteInput));
});

test('overlong, malformed, fabricated-metric, and unsupported-skill drafts use complete fallback', async () => {
  for (const result of [null, { ...draft, note: 'x'.repeat(301) }, { ...draft, evidenceIds: ['invented'] }, { ...draft, note: 'I saved $999,999 using Go.' }, { ...draft, note: 'I built Kubernetes production services.' }]) {
    assert.equal(await generateConnectionNote(noteProvider(result), noteInput), createConnectionNote(noteInput));
  }
  for (const provider of [{ connectionNote: async () => { throw Error('timeout'); } }, { ...noteProvider(), reviewEdits: async () => { throw Error('audit timeout'); } }]) {
    assert.equal(await generateConnectionNote(provider, noteInput), createConnectionNote(noteInput));
  }
});
