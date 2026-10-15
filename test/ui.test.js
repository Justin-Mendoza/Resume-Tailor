import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';

const source = await readFile(new URL('../public/app.js', import.meta.url), 'utf8');

function fakeUi(fetchImpl) {
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
  vm.runInNewContext(source, { document, fetch: fetchImpl });
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
