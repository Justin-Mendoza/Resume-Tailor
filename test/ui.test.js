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
  assert.match(ui.get('analysis-warning').textContent, /Production deployment/);
  assert.match(ui.get('analysis-warning').textContent, /excluded from resume/);
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
