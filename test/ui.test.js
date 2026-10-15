import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';

const source = await readFile(new URL('../public/app.js', import.meta.url), 'utf8');

function fakeUi(fetchImpl, clipboard = { writeText: async () => {} }) {
  const elements = new Map();
  class Element {
    constructor(tagName = 'div') {
      this.tagName = tagName;
      this.children = [];
      this.listeners = new Map();
      this.dataset = {};
      const classes = new Set();
      this.classList = {
        add(...names) { names.forEach(name => classes.add(name)); },
        remove(...names) { names.forEach(name => classes.delete(name)); },
        contains(name) { return classes.has(name); },
        toggle(name, force) { const add = force ?? !classes.has(name); if (add) classes.add(name); else classes.delete(name); }
      };
      this.textContent = '';
      this.disabled = false;
      this.value = '';
    }
    addEventListener(type, handler) { this.listeners.set(type, handler); }
    append(...children) { this.children.push(...children); }
    replaceChildren(...children) { this.children = [...children]; }
    scrollIntoView() {}
    setAttribute() {}
    querySelectorAll() {
      const found = [];
      const visit = element => {
        if (element.tagName === 'input') found.push(element);
        for (const child of element.children ?? []) visit(child);
      };
      visit(this);
      return found;
    }
  }
  const document = {
    getElementById(id) {
      if (!elements.has(id)) elements.set(id, new Element());
      return elements.get(id);
    },
    createElement: tagName => new Element(tagName)
  };
  vm.runInNewContext(source, { document, fetch: fetchImpl, navigator: { clipboard } });
  return { get: id => document.getElementById(id) };
}

const response = value => ({ ok: true, json: async () => value });
const tick = () => new Promise(resolve => setImmediate(resolve));

test('Analyze automatically refines and keeps review locked until Qwen finishes', async () => {
  const calls = [];
  let finishRefinement;
  const localChange = { id: 'change_1', title: 'Use verified wording', original: 'Before', proposed: 'After', reason: 'JD match', jdKeyword: 'Python', confidence: 0.85 };
  const ui = fakeUi(async url => {
    calls.push(url);
    if (url === '/api/status') return response({ configured: true, keyConfigured: true, provider: 'Qwen' });
    if (url === '/api/analyze') return response({ analysisId: 'analysis-one', resumeTitle: 'General', analysis: { job_category: 'backend_swe', important_keywords: ['Python'], matched_keywords: ['Python'], missing_but_verified: [], missing_from_skills: [], unsupported_keywords: [] }, changes: [localChange], warning: '' });
    if (url === '/api/refine') return new Promise(resolve => { finishRefinement = resolve; });
    throw new Error(`Unexpected URL ${url}`);
  });
  ui.get('job-title').value = 'Backend Engineer';
  ui.get('company').value = 'Example';
  ui.get('job-description').value = 'Python backend role';
  await ui.get('job-form').listeners.get('submit')({ preventDefault() {} });
  assert.equal(calls.filter(url => url === '/api/refine').length, 1);
  assert.ok(ui.get('changes-list').querySelectorAll('.decision input').every(input => input.disabled));
  assert.equal(ui.get('compile-button').disabled, true);
  finishRefinement(response({ changes: [localChange], warning: '', replaced: true }));
  await tick();
  assert.ok(ui.get('changes-list').querySelectorAll('.decision input').every(input => !input.disabled));
  assert.match(ui.get('refine-status').textContent, /complete/);
  const approve = ui.get('changes-list').querySelectorAll('.decision input')[0];
  await approve.listeners.get('change')();
  assert.equal(ui.get('compile-button').disabled, false);
});

test('Qwen timeout leaves local suggestions reviewable', async () => {
  const localChange = { id: 'change_1', title: 'Use verified wording', original: 'Before', proposed: 'After', reason: 'JD match', jdKeyword: 'Python', confidence: 0.85 };
  const ui = fakeUi(async url => {
    if (url === '/api/status') return response({ configured: true, keyConfigured: true, provider: 'Qwen' });
    if (url === '/api/analyze') return response({ analysisId: 'analysis-two', resumeTitle: 'General', analysis: { job_category: 'backend_swe', important_keywords: ['Python'], matched_keywords: ['Python'], missing_but_verified: [], missing_from_skills: [], unsupported_keywords: [] }, changes: [localChange], warning: '' });
    if (url === '/api/refine') return response({ changes: [localChange], warning: 'Qwen refinement did not finish.', replaced: false });
    throw new Error(`Unexpected URL ${url}`);
  });
  await ui.get('job-form').listeners.get('submit')({ preventDefault() {} });
  await tick();
  assert.ok(ui.get('changes-list').querySelectorAll('.decision input').every(input => !input.disabled));
  assert.match(ui.get('analysis-warning').textContent, /did not finish/);
});

test('a stale refinement cannot replace suggestions from a newer analysis', async () => {
  let count = 0;
  const finish = new Map();
  const change = name => ({ id: 'change_1', title: name, original: 'Before', proposed: 'After', reason: 'JD match', jdKeyword: 'Python', confidence: 0.85 });
  const ui = fakeUi(async (url, options) => {
    if (url === '/api/status') return response({ configured: true, keyConfigured: true, provider: 'Qwen' });
    if (url === '/api/analyze') {
      count++;
      return response({ analysisId: `analysis-${count}`, resumeTitle: 'General', analysis: { job_category: 'backend_swe', important_keywords: ['Python'], matched_keywords: ['Python'], missing_but_verified: [], missing_from_skills: [], unsupported_keywords: [] }, changes: [change(`Local ${count}`)], warning: '' });
    }
    if (url === '/api/refine') {
      const id = JSON.parse(options.body).analysisId;
      return new Promise(resolve => finish.set(id, resolve));
    }
    throw new Error(`Unexpected URL ${url}`);
  });
  await ui.get('job-form').listeners.get('submit')({ preventDefault() {} });
  await ui.get('job-form').listeners.get('submit')({ preventDefault() {} });
  finish.get('analysis-1')(response({ changes: [change('Stale')], warning: '', replaced: true }));
  await tick();
  assert.ok(ui.get('changes-list').querySelectorAll('.decision input').every(input => input.disabled));
  assert.match(ui.get('refine-status').textContent, /refining/);
  finish.get('analysis-2')(response({ changes: [change('Current')], warning: '', replaced: true }));
  await tick();
  assert.equal(ui.get('changes-list').children[0].children[0].children[0].textContent, 'Current');
  assert.ok(ui.get('changes-list').querySelectorAll('.decision input').every(input => !input.disabled));
});

const sampleChange = { id: 'change_1', title: 'Use verified wording', original: 'Before', proposed: 'After', reason: 'JD match', jdKeyword: 'Python', confidence: 0.85 };
const sampleAnalysis = id => ({ analysisId: id, resumeTitle: 'General', analysis: { job_category: 'backend_swe', important_keywords: ['Python'], matched_keywords: ['Python'], missing_but_verified: [], missing_from_skills: [], unsupported_keywords: [] }, changes: [sampleChange], warning: '' });

test('changing a decision invalidates the previous draft and returns to review', async () => {
  const ui = fakeUi(async url => {
    if (url === '/api/status') return response({ configured: true, keyConfigured: true, provider: 'Test' });
    if (url === '/api/analyze') return response(sampleAnalysis('one'));
    if (url === '/api/refine') return response({ changes: [sampleChange], replaced: false, warning: '' });
    if (url === '/api/compile') return response({ filename: 'resume.pdf', pages: 1, previewUrl: '/pdf', downloadUrl: '/download', latexUrl: '/latex', reportUrl: '/report' });
    throw new Error(`Unexpected URL ${url}`);
  });
  await ui.get('job-form').listeners.get('submit')({ preventDefault() {} });
  await tick();
  const [approve, reject] = ui.get('changes-list').querySelectorAll('.decision input');
  approve.listeners.get('change')();
  await ui.get('compile-button').listeners.get('click')();
  assert.equal(ui.get('output-section').classList.contains('hidden'), false);
  assert.equal(ui.get('nav-output').dataset.state, 'current');
  reject.listeners.get('change')();
  assert.equal(ui.get('output-section').classList.contains('hidden'), true);
  assert.equal(ui.get('nav-output').dataset.state, 'locked');
  assert.equal(ui.get('review-progress').value, 1);
  assert.equal(ui.get('compile-button').disabled, false);
});

test('compilation locks review choices and an old result cannot replace a new application', async () => {
  let finishCompilation;
  let count = 0;
  const ui = fakeUi(async url => {
    if (url === '/api/status') return response({ configured: true, keyConfigured: true, provider: 'Test' });
    if (url === '/api/analyze') return response(sampleAnalysis(`analysis-${++count}`));
    if (url === '/api/refine') return response({ changes: [sampleChange], replaced: false, warning: '' });
    if (url === '/api/compile') return new Promise(resolve => { finishCompilation = resolve; });
    throw new Error(`Unexpected URL ${url}`);
  });
  await ui.get('job-form').listeners.get('submit')({ preventDefault() {} });
  await tick();
  ui.get('changes-list').querySelectorAll('.decision input')[0].listeners.get('change')();
  const pending = ui.get('compile-button').listeners.get('click')();
  assert.equal(ui.get('compile-button').disabled, true);
  assert.ok(ui.get('changes-list').querySelectorAll('.decision input').every(input => input.disabled));
  await ui.get('job-form').listeners.get('submit')({ preventDefault() {} });
  await tick();
  finishCompilation(response({ filename: 'stale.pdf', pages: 1, previewUrl: '/old-pdf', downloadUrl: '/old-download' }));
  await pending;
  assert.equal(ui.get('output-filename').textContent, '');
  assert.equal(ui.get('output-section').classList.contains('hidden'), true);
  assert.equal(ui.get('nav-output').dataset.state, 'locked');
  assert.ok(ui.get('changes-list').querySelectorAll('.decision input').every(input => !input.disabled));
});

test('unverified enhancements appear as confirmation questions outside approvable edits', async () => {
  const ui = fakeUi(async url => {
    if (url === '/api/status') return response({ configured: true, keyConfigured: true, provider: 'Qwen' });
    if (url === '/api/analyze') return response({ analysisId: 'confirmation-test', resumeTitle: 'General', analysis: { job_category: 'backend', important_keywords: [], matched_keywords: [], missing_but_verified: [], unsupported_keywords: [] }, changes: [], warning: '' });
    if (url === '/api/refine') return response({ changes: [], replaced: false, warning: '', confirmations: [{ claim: 'Production deployment', note: 'Was this deployed to production? Update verified evidence before use.' }] });
    throw new Error(`Unexpected URL ${url}`);
  });
  await ui.get('job-form').listeners.get('submit')({ preventDefault() {} });
  await tick();
  assert.match(ui.get('confirmation-list').children[0].textContent, /Production deployment/);
  assert.match(ui.get('confirmation-summary').textContent, /excluded from resume/);
  assert.equal(ui.get('confirmation-details').open, false);
  assert.equal(ui.get('confirmation-details').classList.contains('hidden'), false);
  assert.equal(ui.get('changes-list').querySelectorAll('.decision input').length, 0);
});

test('final report shows weighted diagnostics, exact keywords, presentation gaps and title review', async () => {
  const report = {
    weighted_coverage: { percent: 75, demonstrated_weight: 9, total_weight: 12 },
    critical_demonstrated: ['Go'], critical_not_demonstrated: ['Rust'], exact_keywords_present: ['Go'],
    keywords_already_present: ['Go'], keywords_added: ['Kafka'], semantically_matched: ['Postgres'], missing_requirements: ['Rust'], unsupported_requirements: ['Rust'],
    presentation_gaps: [{ keyword: 'Postgres', suggestion: 'Prefer exact JD wording.' }],
    keyword_saturation: { warnings: [{ keyword: 'Go', location: 'projects:example:bullet', reason: 'Review local repetition.' }] },
    job_title_alignment: { target_title: 'Backend Engineer', remaining_gaps: ['backend'] },
    parsing: { passed: true, visualReview: 'Preview required.' }
  };
  const ui = fakeUi(async url => {
    if (url === '/api/status') return response({ configured: true, keyConfigured: true, provider: 'Kyma' });
    if (url === '/api/analyze') return response({ analysisId: 'diagnostic-ui', resumeTitle: 'General', analysis: { job_category: 'backend', important_keywords: [], matched_keywords: [], missing_but_verified: [], unsupported_keywords: [], report }, changes: [], warning: '' });
    if (url === '/api/refine') return response({ changes: [], replaced: false, warning: '' });
    if (url === '/api/compile') return response({ filename: 'resume.pdf', pages: 1, previewUrl: '/pdf', downloadUrl: '/download', latexUrl: '/latex', reportUrl: '/report', report });
    throw new Error(`Unexpected URL ${url}`);
  });
  await ui.get('job-form').listeners.get('submit')({ preventDefault() {} });
  await tick();
  assert.match(ui.get('coverage-note').textContent, /75%.*9\/12/);
  await ui.get('compile-button').listeners.get('click')();
  const text = ui.get('export-report').textContent;
  assert.match(text, /diagnostic only, not an ATS score/);
  assert.match(text, /Critical requirements demonstrated: Go/);
  assert.match(text, /Exact JD keywords present: Go/);
  assert.match(text, /Unsupported requirements: Rust/);
  assert.match(text, /Postgres: Prefer exact JD wording/);
  assert.match(text, /Repetition review: Go/);
  assert.match(text, /Target title: Backend Engineer/);
});

test('generated connection note shows after PDF generation and copies exactly with friendly feedback', async () => {
  const note = "Hi! I just applied for the Backend Engineer role at Example. My experience with Go aligns with the work you're hiring for. I'd love to connect!";
  const copied = [];
  const ui = fakeUi(async url => {
    if (url === '/api/status') return response({ configured: true, keyConfigured: true, provider: 'Kyma' });
    if (url === '/api/analyze') return response({ analysisId: 'note-ui', resumeTitle: 'General', analysis: { job_category: 'backend', important_keywords: [], matched_keywords: [], missing_but_verified: [], unsupported_keywords: [] }, changes: [], warning: '' });
    if (url === '/api/refine') return response({ changes: [], replaced: false, warning: '' });
    if (url === '/api/compile') return response({ filename: 'resume.pdf', pages: 1, previewUrl: '/pdf', downloadUrl: '/download', connectionNote: note });
    throw new Error(`Unexpected URL ${url}`);
  }, { writeText: async text => { copied.push(text); } });
  await ui.get('job-form').listeners.get('submit')({ preventDefault() {} });
  await tick();
  assert.ok(ui.get('connection-note-card').classList.contains('hidden'));
  await ui.get('compile-button').listeners.get('click')();
  assert.equal(ui.get('connection-note-text').textContent, note);
  assert.equal(ui.get('connection-note-count').textContent, `${note.length}/300 characters`);
  assert.equal(ui.get('connection-note-card').classList.contains('hidden'), false);
  await ui.get('copy-connection-note').listeners.get('click')();
  assert.deepEqual(copied, [note]);
  assert.match(ui.get('connection-note-status').textContent, /Copied/);
  await ui.get('job-form').listeners.get('submit')({ preventDefault() {} });
  await ui.get('copy-connection-note').listeners.get('click')();
  assert.equal(copied.length, 1);
});

test('clipboard failure gives manual-copy guidance without disrupting generated resume', async () => {
  const ui = fakeUi(async url => {
    if (url === '/api/status') return response({ configured: true, keyConfigured: true, provider: 'Kyma' });
    if (url === '/api/analyze') return response({ analysisId: 'copy-failure', resumeTitle: 'General', analysis: { job_category: 'backend', important_keywords: [], matched_keywords: [], missing_but_verified: [], unsupported_keywords: [] }, changes: [], warning: '' });
    if (url === '/api/refine') return response({ changes: [], replaced: false, warning: '' });
    if (url === '/api/compile') return response({ filename: 'resume.pdf', pages: 1, connectionNote: "Hi! I applied for the role. I'd love to connect!" });
    throw new Error(`Unexpected URL ${url}`);
  }, { writeText: async () => { throw Error('Clipboard permission denied'); } });
  await ui.get('job-form').listeners.get('submit')({ preventDefault() {} });
  await tick();
  await ui.get('compile-button').listeners.get('click')();
  await ui.get('copy-connection-note').listeners.get('click')();
  assert.match(ui.get('connection-note-status').textContent, /copy it manually/);
  assert.equal(ui.get('copy-connection-note').disabled, false);
  assert.equal(ui.get('output-section').classList.contains('hidden'), false);
});

test('PDF is ready while the LLM note loads; personalization cannot overwrite a newer application', async () => {
  let finishNote;
  const fallback = "Hi! I applied. I'd love to connect!";
  const personalized = "Hi! I applied for Backend Engineer at Example. I've built Go ingestion services and would love to connect!";
  const ui = fakeUi(async url => {
    if (url === '/api/status') return response({ configured: true, keyConfigured: true, provider: 'Kyma' });
    if (url === '/api/analyze') return response({ analysisId: 'async-note', resumeTitle: 'General', analysis: { job_category: 'backend', important_keywords: [], matched_keywords: [], missing_but_verified: [], unsupported_keywords: [] }, changes: [], warning: '' });
    if (url === '/api/refine') return response({ changes: [], replaced: false, warning: '' });
    if (url === '/api/compile') return response({ filename: 'resume.pdf', pages: 1, connectionNote: fallback, connectionNotePending: true });
    if (url === '/api/connection-note') return new Promise(resolve => { finishNote = resolve; });
    throw new Error(`Unexpected URL ${url}`);
  });
  await ui.get('job-form').listeners.get('submit')({ preventDefault() {} });
  await tick();
  await ui.get('compile-button').listeners.get('click')();
  assert.equal(ui.get('output-section').classList.contains('hidden'), false);
  assert.equal(ui.get('copy-connection-note').disabled, true);
  finishNote(response({ connectionNote: personalized }));
  await tick();
  assert.equal(ui.get('connection-note-text').textContent, personalized);
  assert.equal(ui.get('copy-connection-note').disabled, false);
  await ui.get('compile-button').listeners.get('click')();
  await ui.get('job-form').listeners.get('submit')({ preventDefault() {} });
  finishNote(response({ connectionNote: 'Stale message' }));
  await tick();
  assert.equal(ui.get('connection-note-card').classList.contains('hidden'), true);
  assert.notEqual(ui.get('connection-note-text').textContent, 'Stale message');
});

test('in-progress education evidence gets a degree status instead of no evidence', async () => {
  const ui = fakeUi(async url => {
    if (url === '/api/status') return response({ configured: true, keyConfigured: true, provider: 'Kyma' });
    if (url === '/api/analyze') return response({ analysisId: 'degree-ui', resumeTitle: 'AI', analysis: { job_category: 'ai', important_keywords: [], matched_keywords: [], missing_but_verified: [], unsupported_keywords: [], requirements: [{ keyword: 'BS in Computer Science', priority: 'critical', source: 'Must have BS in Computer Science', status: 'related', evidence_basis: 'education_record', evidence: [{ text: 'Bachelor of Computer Science — Concordia University; Sept. 2023 – Dec. 2026', completion_status: 'in_progress', rationale: 'Degree is in progress.' }] }] }, changes: [], warning: '' });
    if (url === '/api/refine') return response({ changes: [], replaced: false, warning: '' });
    throw new Error(`Unexpected URL ${url}`);
  });
  await ui.get('job-form').listeners.get('submit')({ preventDefault() {} });
  await tick();
  const row = ui.get('requirement-report').children[0];
  assert.equal(row.children[0].children[2].textContent, 'Degree in progress');
  assert.match(row.children[2].textContent, /Bachelor of Computer Science.*Concordia/);
});

test('confirmed employment duration and attendance confirmations show clear labels without technical gap counts', async () => {
  const ui = fakeUi(async url => {
    if (url === '/api/status') return response({ configured: true, keyConfigured: true, provider: 'Kyma' });
    if (url === '/api/analyze') return response({ analysisId: 'employment-ui', resumeTitle: 'Infrastructure', analysis: { job_category: 'backend', important_keywords: [], matched_keywords: [], missing_but_verified: [], unsupported_keywords: [], report: { missing_requirements: [] }, requirements: [
      { keyword: '6 months of software engineering experience', priority: 'critical', source: '6 months', status: 'equivalent', evidence_basis: 'employment_dates', experience_duration: { verified_months: 8, minimum_months: 6 }, evidence: [{ text: 'Two confirmed four-month internships.' }] },
      { keyword: 'In-person attendance', priority: 'high', source: 'Three days per week', status: 'unsupported', requires_confirmation: true, evidence: [] }
    ] }, changes: [], warning: '' });
    if (url === '/api/refine') return response({ changes: [], replaced: false, warning: '' });
    throw new Error(`Unexpected URL ${url}`);
  });
  await ui.get('job-form').listeners.get('submit')({ preventDefault() {} });
  await tick();
  const rows = ui.get('requirement-report').children;
  assert.equal(rows[0].children[0].children[2].textContent, '8 months verified');
  assert.equal(rows[1].children[0].children[2].textContent, 'Confirm preference / eligibility');
  assert.equal(ui.get('gap-count').textContent, 0);
});

test('final match card reports final coverage, honest deltas, gaps, keywords and unverified PDF checks', async () => {
  for (const [before, after, expected, delta] of [[50, 75, '75%', '+25 percentage points'], [75, 75, '75%', '0 percentage points'], [75, 50, '50%', '-25 percentage points'], [null, null, 'N/A', '0/0 weighted points']]) {
    const report = { baseline_weighted_coverage: { percent: before }, weighted_coverage: { percent: after, total_weight: after === null ? 0 : 20, demonstrated_weight: after === null ? 0 : after / 5 }, critical_demonstrated: ['Go'], critical_not_demonstrated: ['ROS 2'], keyword_visibility: { present: 1, total: 2, keywords: [{ keyword: 'Go', present: true }, { keyword: 'PostgreSQL', present: false }] }, keywords_already_present: ['Go'], keywords_added: [], semantically_matched: ['Go'], missing_requirements: ['ROS 2'], presentation_gaps: [], parsing: { passed: false } };
    const ui = fakeUi(async url => {
      if (url === '/api/status') return response({ configured: true, keyConfigured: true });
      if (url === '/api/analyze') return response({ analysisId: 'match-ui', resumeTitle: 'Infrastructure', analysis: { important_keywords: [], matched_keywords: [], missing_but_verified: [], unsupported_keywords: [] }, changes: [] });
      if (url === '/api/refine') return response({ changes: [], replaced: false });
      if (url === '/api/compile') return response({ filename: 'resume.pdf', pages: 1, report });
      throw Error(`Unexpected ${url}`);
    });
    await ui.get('job-form').listeners.get('submit')({ preventDefault() {} }); await tick();
    await ui.get('compile-button').listeners.get('click')();
    assert.equal(ui.get('job-match-card').classList.contains('hidden'), false);
    assert.equal(ui.get('job-match-score').textContent, expected);
    assert.ok(ui.get('job-match-change').textContent.includes(delta));
    assert.equal(ui.get('job-match-critical').textContent, 'Critical requirements demonstrated: 1/2');
    assert.equal(ui.get('job-match-keywords').textContent, 'Supported JD keywords visible: 1/2');
    assert.match(ui.get('job-match-pdf').textContent, /Not verified/);
    const detailText = ui.get('job-match-details').children.flatMap(e => [e.textContent, ...e.children.map(c => c.textContent)]).join(' ');
    assert.match(detailText, /ROS 2/);
    assert.match(detailText, /PostgreSQL/);
    await ui.get('job-form').listeners.get('submit')({ preventDefault() {} });
    assert.equal(ui.get('job-match-card').classList.contains('hidden'), true);
  }
});

test('accept all selects only reviewable changes, preserves individual overrides, and sends the correct decisions', async () => {
  let finishRefinement, sent;
  const changes = ['one', 'two'].map(id => ({ id, title: id, original: 'Original', proposed: 'Verified edit', reason: 'Relevant', jdKeyword: 'Go' }));
  const ui = fakeUi(async (url, options) => {
    if (url === '/api/status') return response({ configured: true, keyConfigured: true });
    if (url === '/api/analyze') return response({ analysisId: 'bulk', resumeTitle: 'Infrastructure', analysis: { job_category: 'backend', important_keywords: [], matched_keywords: [], missing_but_verified: [], unsupported_keywords: [] }, changes });
    if (url === '/api/refine') return new Promise(resolve => { finishRefinement = resolve; });
    if (url === '/api/compile') { sent = JSON.parse(options.body); return response({ filename: 'resume.pdf', pages: 1 }); }
    throw Error(`Unexpected ${url}`);
  });
  await ui.get('job-form').listeners.get('submit')({ preventDefault() {} }); await tick();
  assert.equal(ui.get('accept-all-button').disabled, true);
  ui.get('accept-all-button').listeners.get('click')();
  assert.equal(ui.get('review-count').textContent, '0 of 2 reviewed');
  finishRefinement(response({ changes, replaced: false, confirmations: [{ claim: 'Unverified leadership', note: 'Confirm before use.' }] })); await tick();
  assert.equal(ui.get('accept-all-button').disabled, false);
  ui.get('accept-all-button').listeners.get('click')();
  assert.equal(ui.get('review-count').textContent, '2 of 2 reviewed');
  assert.equal(ui.get('compile-button').disabled, false);
  const radios = ui.get('changes-list').querySelectorAll('.decision input');
  assert.deepEqual(radios.map(r => r.checked), [true, false, true, false]);
  assert.equal(ui.get('accept-all-button').disabled, true);
  // A manual rejection after bulk acceptance remains authoritative.
  radios[3].listeners.get('change')();
  assert.equal(ui.get('accept-all-button').disabled, false);
  await ui.get('compile-button').listeners.get('click')();
  assert.deepEqual(sent.decisions, [{ id: 'one', approved: true }, { id: 'two', approved: false }]);
  assert.equal(sent.decisions.some(d => d.id === 'Unverified leadership'), false);
  ui.get('accept-all-button').listeners.get('click')();
  assert.equal(ui.get('output-section').classList.contains('hidden'), true);
});

test('accept all stays disabled when there are no suggested changes', async () => {
  const ui = fakeUi(async url => {
    if (url === '/api/status') return response({ configured: true, keyConfigured: true });
    if (url === '/api/analyze') return response({ analysisId: 'empty-bulk', resumeTitle: 'General', analysis: { job_category: 'backend', important_keywords: [], matched_keywords: [], missing_but_verified: [], unsupported_keywords: [] }, changes: [] });
    if (url === '/api/refine') return response({ changes: [], replaced: false });
    throw Error(`Unexpected ${url}`);
  });
  await ui.get('job-form').listeners.get('submit')({ preventDefault() {} }); await tick();
  assert.equal(ui.get('accept-all-button').disabled, true);
  ui.get('accept-all-button').listeners.get('click')();
  assert.equal(ui.get('review-count').textContent, '0 of 0 reviewed');
});
