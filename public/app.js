const $ = id => document.getElementById(id);
let current = null;
let refining = false;
let analysisGeneration = 0;
const decisions = new Map();

function showError(message) {
  $('error').textContent = message;
  $('error').classList.remove('hidden');
  $('error').scrollIntoView({ behavior: 'smooth', block: 'nearest' });
}

function clearError() { $('error').classList.add('hidden'); $('error').textContent = ''; }

async function request(url, options) {
  const response = await fetch(url, options);
  const value = await response.json();
  if (!response.ok) throw new Error(value.error || 'Request failed');
  return value;
}

function post(url, body) { return request(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }); }

function setBusy(button, busy, label) {
  button.disabled = busy;
  button.textContent = busy ? label : button.dataset.original;
}

function renderChips(id, items, tone = '') {
  const target = $(id);
  target.replaceChildren();
  if (!items.length) { const empty = document.createElement('span'); empty.className = 'empty'; empty.textContent = 'None identified'; target.append(empty); return; }
  for (const item of items) {
    const chip = document.createElement('span');
    chip.className = `chip ${tone}`;
    chip.textContent = item;
    target.append(chip);
  }
}

function updateReviewCount() {
  const total = current?.changes.length ?? 0;
  $('review-count').textContent = `${decisions.size} of ${total} reviewed`;
  $('compile-button').disabled = refining || decisions.size !== total;
}

function setReviewLocked(locked) {
  $('changes-section').setAttribute('aria-busy', String(locked));
  for (const input of $('changes-list').querySelectorAll('.decision input')) input.disabled = locked;
  updateReviewCount();
}

function showWarning(message) {
  $('analysis-warning').textContent = message || '';
  $('analysis-warning').classList.toggle('hidden', !message);
}

function renderChanges(changes) {
  const list = $('changes-list');
  list.replaceChildren();
  decisions.clear();
  for (const change of changes) {
    const card = document.createElement('article'); card.className = 'change-card';
    const header = document.createElement('div'); header.className = 'change-head';
    const title = document.createElement('h3'); title.textContent = change.title;
    const confidence = document.createElement('span'); confidence.className = 'confidence'; confidence.textContent = `${Math.round(change.confidence * 100)}% confidence`;
    header.append(title, confidence);
    const diff = document.createElement('div'); diff.className = 'diff';
    for (const [kind, text] of [['before', change.original], ['after', change.proposed]]) {
      const row = document.createElement('div'); row.className = `diff-row ${kind}`;
      const sign = document.createElement('span'); sign.className = 'diff-sign'; sign.textContent = kind === 'before' ? '−' : '+';
      const content = document.createElement('pre'); content.textContent = text;
      row.append(sign, content); diff.append(row);
    }
    const meta = document.createElement('p'); meta.className = 'change-reason'; meta.textContent = `${change.reason} · JD keyword: ${change.jdKeyword}`;
    const controls = document.createElement('div'); controls.className = 'decision-controls';
    for (const [value, label] of [['approve', 'Approve'], ['reject', 'Reject']]) {
      const wrap = document.createElement('label'); wrap.className = 'decision';
      const radio = document.createElement('input'); radio.type = 'radio'; radio.name = change.id; radio.value = value; radio.disabled = refining;
      radio.addEventListener('change', () => { decisions.set(change.id, value === 'approve'); updateReviewCount(); });
      const text = document.createElement('span'); text.textContent = label;
      wrap.append(radio, text); controls.append(wrap);
    }
    card.append(header, diff, meta, controls); list.append(card);
  }
  if (!changes.length) { const note = document.createElement('p'); note.className = 'no-changes'; note.textContent = 'No safe change was found. You can compile the recommended base resume as it is.'; list.append(note); }
  updateReviewCount();
}

$('analyze-button').dataset.original = $('analyze-button').textContent;
$('refine-button').dataset.original = $('refine-button').textContent;
$('compile-button').dataset.original = $('compile-button').textContent;

async function runRefinement(generation) {
  if (!current || refining) return;
  const analysisId = current.analysisId;
  const button = $('refine-button');
  refining = true;
  setBusy(button, true, 'Refining with Qwen…');
  $('refine-status').textContent = 'Qwen is refining the verified suggestions. Review controls will unlock when it finishes.';
  setReviewLocked(true);
  try {
    const result = await post('/api/refine', { analysisId });
    if (generation !== analysisGeneration || current?.analysisId !== analysisId) return;
    if (result.replaced) {
      current.changes = result.changes;
      renderChanges(result.changes);
      $('output-section').classList.add('hidden');
    }
    showWarning(result.warning);
    $('refine-status').textContent = result.warning ? 'Verified suggestions are ready to review. You can retry Qwen if you want.' : 'Qwen refinement is complete. Review each proposed change.';
  } catch {
    if (generation !== analysisGeneration || current?.analysisId !== analysisId) return;
    showWarning('Qwen refinement could not finish. Your verified suggestions are unchanged.');
    $('refine-status').textContent = 'Verified suggestions are ready to review. You can retry Qwen if you want.';
  } finally {
    if (generation === analysisGeneration && current?.analysisId === analysisId) {
      refining = false;
      setBusy(button, false);
      setReviewLocked(false);
    }
  }
}

$('job-form').addEventListener('submit', async event => {
  event.preventDefault(); clearError();
  const generation = ++analysisGeneration;
  current = null;
  refining = false;
  setBusy($('refine-button'), false);
  const button = $('analyze-button'); setBusy(button, true, 'Analyzing…');
  $('analysis-section').classList.add('hidden'); $('changes-section').classList.add('hidden'); $('output-section').classList.add('hidden');
  try {
    const value = await post('/api/analyze', { jobTitle: $('job-title').value, company: $('company').value, jobDescription: $('job-description').value });
    if (generation !== analysisGeneration) return;
    current = value;
    $('recommended-resume').textContent = value.resumeTitle;
    $('job-category').textContent = value.analysis.job_category.replaceAll('_', ' ');
    renderChips('important-keywords', value.analysis.important_keywords);
    renderChips('matched-keywords', value.analysis.matched_keywords, 'matched');
    renderChips('missing-keywords', value.analysis.missing_but_verified, 'missing');
    renderChips('missing-skills-keywords', value.analysis.missing_from_skills ?? [], 'missing');
    renderChips('unsupported-keywords', value.analysis.unsupported_keywords, 'unsupported-chip');
    showWarning(value.warning);
    renderChanges(value.changes);
    $('analysis-section').classList.remove('hidden'); $('changes-section').classList.remove('hidden');
    $('analysis-section').scrollIntoView({ behavior: 'smooth', block: 'start' });
    void runRefinement(generation);
  } catch (error) { if (generation === analysisGeneration) showError(error.message); }
  finally { if (generation === analysisGeneration) setBusy(button, false); }
});

$('refine-button').addEventListener('click', () => { clearError(); void runRefinement(analysisGeneration); });

$('compile-button').addEventListener('click', async () => {
  if (!current) return;
  clearError();
  const button = $('compile-button'); setBusy(button, true, 'Compiling…');
  try {
    const result = await post('/api/compile', { analysisId: current.analysisId, decisions: current.changes.map(x => ({ id: x.id, approved: decisions.get(x.id) })) });
    $('output-filename').textContent = result.filename;
    $('output-note').textContent = result.pages === null ? 'Compiled. Page count could not be checked on this system.' : `${result.pages} page · compiled and ready to save.`;
    $('download-link').href = result.downloadUrl;
    $('pdf-preview').src = `${result.previewUrl}?t=${Date.now()}`;
    $('output-section').classList.remove('hidden');
    $('output-section').scrollIntoView({ behavior: 'smooth', block: 'start' });
  } catch (error) { showError(error.message); }
  finally { setBusy(button, false); updateReviewCount(); }
});

request('/api/status').then(status => {
  $('status').textContent = status.configured
    ? `${status.provider} · ${status.keyConfigured ? 'API key ready' : 'Add KYMA_API_KEY to .env'} · 3 verified base resumes loaded`
    : 'Profile setup needed: add verified content and three base resumes.';
  $('status').classList.toggle('status-warning', !status.configured || !status.keyConfigured);
}).catch(error => { $('status').textContent = `Setup check failed: ${error.message}`; $('status').classList.add('status-warning'); });
