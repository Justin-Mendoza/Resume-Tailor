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
      this.classList = { add() {}, remove() {}, toggle() {} };
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
