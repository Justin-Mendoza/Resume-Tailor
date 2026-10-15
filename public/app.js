const $ = id => document.getElementById(id);
let current = null;
let refining = false;
let compiling = false;
let analysisGeneration = 0;
const decisions = new Map();

function setWorkflow(stage) {
  for (const [index, name] of ['job', 'analysis', 'review', 'output'].entries()) {
    const link = $(`nav-${name}`);
    const locked = index > stage;
    link.dataset.state = locked ? 'locked' : index === stage ? 'current' : 'done';
    link.setAttribute('aria-disabled', String(locked));
    link.setAttribute('tabindex', locked ? '-1' : '0');
    link.setAttribute('aria-current', index === stage ? 'step' : 'false');
  }
}

$('job-description').addEventListener('input', () => {
  const text = $('job-description').value.trim();
  const words = text ? text.split(/\s+/).length : 0;
  $('description-count').textContent = `${words.toLocaleString()} ${words === 1 ? 'word' : 'words'}`;
});

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
  button.dataset.busy = String(busy);
  button.setAttribute('aria-busy', String(busy));
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

function renderRequirements(analysis) {
  $('coverage-note').textContent = 'Coverage is a guide to relevance, not an ATS score. Related experience does not establish the same skill.';
  $('exact-count').textContent = analysis.report?.explicitly_matched?.length ?? 0;
  $('equivalent-count').textContent = analysis.report?.semantically_matched?.length ?? 0;
  $('gap-count').textContent = analysis.report?.missing_requirements?.length ?? analysis.unsupported_keywords?.length ?? 0;
  const list = $('requirement-report');
  list.replaceChildren();
  for (const requirement of analysis.requirements ?? []) {
    const row = document.createElement('details');
    const summary = document.createElement('summary');
    const keyword = document.createElement('span'); keyword.className = 'requirement-keyword'; keyword.textContent = requirement.keyword;
    const priority = document.createElement('span'); priority.className = 'priority-badge'; priority.textContent = `${requirement.priority} priority`;
    const match = document.createElement('span'); match.className = 'match-badge'; match.dataset.match = requirement.status;
    match.textContent = ({ exact: 'Explicit match', equivalent: 'Equivalent', related: 'Related only', unsupported: 'No evidence' })[requirement.status] ?? requirement.status;
    summary.append(keyword, priority, match);
    const source = document.createElement('p');
    source.className = 'evidence-source';
    source.textContent = `From the posting: “${requirement.source}”`;
    row.append(summary, source);
    for (const evidence of requirement.evidence ?? []) {
      const item = document.createElement('p');
      item.textContent = `${evidence.text}${evidence.rationale ? ' — ' + evidence.rationale : ''}`;
      row.append(item);
    }
    list.append(row);
  }
}

function updateReviewCount() {
  const total = current?.changes.length ?? 0;
  $('review-count').textContent = `${decisions.size} of ${total} reviewed`;
  $('compile-button').disabled = refining || compiling || decisions.size !== total;
  $('review-progress').max = total || 1;
  $('review-progress').value = total ? decisions.size : 1;
  const approved = [...decisions.values()].filter(Boolean).length;
  $('review-hint').textContent = compiling ? 'Preparing your selected changes and checking the PDF…' : refining ? 'Finishing the suggestions. Review will open in a moment.' : decisions.size !== total ? 'Choose an option for each suggestion to continue.' : total ? `${approved} ${approved === 1 ? 'change' : 'changes'} selected. Your original facts stay intact.` : 'Your base resume is ready to preview.';
}

function setReviewLocked(locked) {
  $('changes-section').setAttribute('aria-busy', String(locked));
  for (const input of $('changes-list').querySelectorAll('.decision input')) input.disabled = locked || compiling;
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
    const confidence = document.createElement('span'); confidence.className = 'confidence'; confidence.textContent = 'Source checked';
    header.append(title, confidence);
    const diff = document.createElement('div'); diff.className = 'diff';
    for (const [kind, text] of [['before', change.original], ['after', change.proposed]]) {
      const row = document.createElement('div'); row.className = `diff-row ${kind}`;
      const sign = document.createElement('span'); sign.className = 'diff-sign'; sign.textContent = kind === 'before' ? 'Original' : 'Suggested';
      const content = document.createElement('pre'); content.textContent = text;
      row.append(sign, content); diff.append(row);
    }
    const meta = document.createElement('p'); meta.className = 'change-reason'; meta.textContent = `${change.reason} · Relevant to ${change.jdKeyword}`;
    const controls = document.createElement('div'); controls.className = 'decision-controls';
    for (const [value, label] of [['approve', 'Use this change'], ['reject', 'Keep original']]) {
      const wrap = document.createElement('label'); wrap.className = 'decision';
      const radio = document.createElement('input'); radio.type = 'radio'; radio.name = change.id; radio.value = value; radio.disabled = refining;
      radio.addEventListener('change', () => { decisions.set(change.id, value === 'approve'); $('output-section').classList.add('hidden'); setWorkflow(2); updateReviewCount(); });
      const text = document.createElement('span'); text.textContent = label;
      wrap.append(radio, text); controls.append(wrap);
    }
    card.append(header, diff, meta, controls); list.append(card);
  }
  if (!changes.length) { const note = document.createElement('p'); note.className = 'no-changes'; note.textContent = 'Your experience already speaks well for itself. Preview the recommended resume, or take another look for possible refinements.'; list.append(note); }
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
  setBusy(button, true, 'Taking another look…');
  $('refine-status').textContent = 'We’re refining the suggested changes. You’ll be able to review them as soon as this finishes.';
  setReviewLocked(true);
  try {
    const result = await post('/api/refine', { analysisId });
    if (generation !== analysisGeneration || current?.analysisId !== analysisId) return;
    if (result.replaced) {
      current.changes = result.changes;
      renderChanges(result.changes);
      $('output-section').classList.add('hidden');
      setWorkflow(2);
    }
    showWarning(result.warning);
    $('refine-status').textContent = result.warning ? 'Your verified suggestions are ready. You can take another look whenever you like.' : 'The review is complete. Choose the changes you’d like to keep.';
  } catch {
    if (generation !== analysisGeneration || current?.analysisId !== analysisId) return;
    showWarning('The extra review couldn’t finish. Your verified suggestions are still ready below.');
    $('refine-status').textContent = 'Your verified suggestions are ready. You can take another look whenever you like.';
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
  decisions.clear();
  setWorkflow(0);
  $('starting-note').classList.remove('hidden');
  refining = false;
  compiling = false;
  setBusy($('compile-button'), false);
  setBusy($('refine-button'), false);
  const button = $('analyze-button'); setBusy(button, true, 'Finding the overlap…');
  $('analysis-section').classList.add('hidden'); $('changes-section').classList.add('hidden'); $('output-section').classList.add('hidden');
  try {
    const value = await post('/api/analyze', { jobTitle: $('job-title').value, company: $('company').value, jobDescription: $('job-description').value });
    if (generation !== analysisGeneration) return;
    current = value;
    setWorkflow(2);
    $('starting-note').classList.add('hidden');
    $('recommended-resume').textContent = value.resumeTitle;
    $('job-category').textContent = value.analysis.job_category.replaceAll('_', ' ');
    renderChips('important-keywords', value.analysis.important_keywords);
    renderChips('matched-keywords', value.analysis.matched_keywords, 'matched');
    renderChips('missing-keywords', value.analysis.missing_but_verified, 'missing');
    renderChips('missing-skills-keywords', value.analysis.missing_from_skills ?? [], 'missing');
    renderChips('unsupported-keywords', value.analysis.unsupported_keywords, 'unsupported-chip');
    renderRequirements(value.analysis);
    showWarning(value.warning);
    renderChanges(value.changes);
    $('analysis-section').classList.remove('hidden'); $('changes-section').classList.remove('hidden');
    $('analysis-section').scrollIntoView({ behavior: 'smooth', block: 'start' });
    $('analysis-heading').focus?.({ preventScroll: true });
    void runRefinement(generation);
  } catch (error) { if (generation === analysisGeneration) showError(error.message); }
  finally { if (generation === analysisGeneration) setBusy(button, false); }
});

$('refine-button').addEventListener('click', () => { clearError(); void runRefinement(analysisGeneration); });

$('compile-button').addEventListener('click', async () => {
  if (!current || refining || compiling) return;
  const generation = analysisGeneration;
  const analysisId = current.analysisId;
  compiling = true;
  clearError();
  $('refine-button').disabled = true;
  setReviewLocked(true);
  const button = $('compile-button'); setBusy(button, true, 'Creating your draft…');
  try {
    const result = await post('/api/compile', { analysisId: current.analysisId, decisions: current.changes.map(x => ({ id: x.id, approved: decisions.get(x.id) })) });
    if (generation !== analysisGeneration || current?.analysisId !== analysisId) return;
    $('output-filename').textContent = result.filename;
    $('output-note').textContent = result.pages === null ? 'Your PDF is ready. Check the page count in the preview.' : `${result.pages} page · Ready for one last look.`;
    $('download-link').href = result.downloadUrl;
    $('latex-link').href = result.latexUrl;
    $('report-link').href = result.reportUrl;
    $('export-report').textContent = result.report ? `Already present: ${result.report.keywords_already_present.join(', ') || 'None'}\nAdded through approved edits: ${result.report.keywords_added.join(', ') || 'None'}\nEquivalent matches: ${result.report.semantically_matched.join(', ') || 'None'}\nRemaining gaps: ${result.report.missing_requirements.join(', ') || 'None'}\nPDF text validation: ${result.report.parsing.passed ? 'Passed' : 'Failed'}\n${result.report.parsing.visualReview}` : '';
    $('pdf-preview').src = `${result.previewUrl}?t=${Date.now()}`;
    $('output-section').classList.remove('hidden');
    setWorkflow(3);
    $('output-section').scrollIntoView({ behavior: 'smooth', block: 'start' });
    $('output-heading').focus?.({ preventScroll: true });
  } catch (error) { if (generation === analysisGeneration && current?.analysisId === analysisId) showError(error.message); }
  finally {
    if (generation === analysisGeneration && current?.analysisId === analysisId) {
      compiling = false;
      setBusy(button, false);
      $('refine-button').disabled = false;
      setReviewLocked(false);
    }
  }
});

request('/api/status').then(status => {
  $('status').textContent = status.configured
    ? status.keyConfigured ? 'Ready when you are. Three verified resumes are loaded.' : 'One setup step left: add your API key to the local .env file.'
    : 'Add your verified profile and base resumes to get started.';
  $('provider-details').textContent = `${status.provider} · Files stay on this computer.`;
  const needsSetup = !status.configured || !status.keyConfigured;
  $('status').classList.toggle('status-warning', needsSetup);
  $('setup-notice').textContent = needsSetup ? $('status').textContent : '';
  $('setup-notice').classList.toggle('hidden', !needsSetup);
}).catch(error => { $('status').textContent = `Setup check failed: ${error.message}`; $('status').classList.add('status-warning'); });
