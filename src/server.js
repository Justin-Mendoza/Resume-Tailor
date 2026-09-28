import http from 'node:http';
import { readFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { loadData, isConfigured } from './data.js';
import { analyzeMatches, containsTerm, normalize } from './matcher.js';
import { validateSuggestions, fallbackSuggestions, combineSuggestions, applyApproved } from './editor.js';
import { createProvider } from './providers/index.js';
import { compileResume } from './compiler.js';

const root = path.resolve(import.meta.dirname, '..');
const envFile = path.join(root, '.env');
if (existsSync(envFile)) process.loadEnvFile(envFile);
const provider = createProvider();
const sessions = new Map();
const maxBody = 150_000;

function sendJson(res, status, value) {
  const data = Buffer.from(JSON.stringify(value));
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Content-Length': data.length, 'Cache-Control': 'no-store' });
  res.end(data);
}

function readJson(req) {
  return new Promise((resolve, reject) => {
    let body = '';
    req.on('data', chunk => {
      body += chunk;
      if (body.length > maxBody) { reject(new Error('Request is too large')); req.destroy(); }
    });
    req.on('end', () => {
      try { resolve(JSON.parse(body)); }
      catch { reject(new Error('Invalid JSON request')); }
    });
    req.on('error', reject);
  });
}

function cleanText(value, name, max) {
  const text = String(value ?? '').trim();
  if (!text || text.length > max) throw new Error(`${name} must be between 1 and ${max} characters`);
  return text;
}

function sessionFor(id) {
  const session = sessions.get(id);
  if (!session || Date.now() - session.created > 60 * 60 * 1000) throw new Error('Analysis expired. Analyze the job again.');
  return session;
}

function publicChanges(changes) {
  return changes.map(({ id, title, original, proposed, reason, jdKeyword, confidence }) => ({ id, title, original, proposed, reason, jdKeyword, confidence }));
}

async function analyze(req, res) {
  const { profile, resumes } = await loadData();
  if (!isConfigured(profile, resumes)) throw new Error('Verified profile and three resumes are not configured yet.');
  const body = await readJson(req);
  const jobTitle = cleanText(body.jobTitle, 'Job title', 120);
  const company = cleanText(body.company, 'Company', 120);
  const jd = cleanText(body.jobDescription, 'Job description', 50_000);
  if (jd.length < 80) throw new Error('Paste a fuller job description (at least 80 characters).');
  const raw = await provider.analyzeJD({ jobTitle, company, jobDescription: jd, resumeChoices: Object.values(resumes).map(({ id, title }) => ({ id, title })) });
  if (!raw || !Array.isArray(raw.important_keywords)) throw new Error('Qwen returned an incomplete job analysis. Try again.');
  const analysis = analyzeMatches(jd, raw, profile, resumes);
  const resume = resumes[analysis.recommended_resume];
  const relevantSkills = profile.skills.filter(skill => analysis.important_keywords.some(keyword => [skill.label, ...(skill.aliases ?? [])].some(alias => normalize(alias) === normalize(keyword))));
  const relevantBullets = ['experience', 'projects'].flatMap(section => resume[section].map(sel => {
    const entry = profile[section].find(x => x.id === sel.entryId);
    return { section, entryId: entry.id, bulletIds: sel.bulletIds, relevantBullets: sel.bulletIds.map(id => {
      const bullet = entry.bullets.find(x => x.id === id);
      const variantIndex = resume.variants?.[`${section}:${entry.id}:${id}`];
      return { id, currentText: variantIndex === undefined ? bullet.text : bullet.variants[variantIndex], variants: bullet.variants ?? [], skillIds: bullet.skillIds ?? [] };
    }).filter(bullet => analysis.important_keywords.some(keyword => containsTerm(bullet.currentText, keyword) || bullet.variants.some(variant => containsTerm(variant, keyword)) || bullet.skillIds.some(id => relevantSkills.some(skill => skill.id === id)))) };
  })).filter(entry => entry.relevantBullets.length);
  const selectedResume = {
    id: resume.id,
    skillGroups: resume.skillGroups.map(group => ({ label: group.label, skills: group.skillIds.map(id => ({ id, label: profile.skills.find(skill => skill.id === id).label })) })),
    projects: resume.projects.map(project => ({ entryId: project.entryId, name: profile.projects.find(entry => entry.id === project.entryId).nameVariants[project.nameVariant], technologies: project.techSkillIds.map(id => ({ id, label: profile.skills.find(skill => skill.id === id).label })) })),
    entries: relevantBullets
  };
  const suggestions = fallbackSuggestions(analysis, profile, resume);
  const editInput = { jobTitle, jobCategory: analysis.job_category, keywords: analysis.important_keywords, missingButVerified: relevantSkills.filter(skill => analysis.missing_but_verified.some(keyword => [skill.label, ...(skill.aliases ?? [])].some(alias => normalize(alias) === normalize(keyword)))).map(({ id, label, categories }) => ({ id, label, categories })), missingFromSkills: relevantSkills.filter(skill => analysis.missing_from_skills.some(keyword => [skill.label, ...(skill.aliases ?? [])].some(alias => normalize(alias) === normalize(keyword)))).map(({ id, label, categories }) => ({ id, label, categories })), unsupported: analysis.unsupported_keywords, selectedResume, safeCandidates: suggestions.map(({ edit, original, proposed, jdKeyword }) => ({ ...edit, original, proposed, jdKeyword })) };
  const warning = suggestions.length ? '' : 'No safe content change was found for this posting. You can still compile the best matching base resume.';
  const id = randomUUID();
  sessions.set(id, { created: Date.now(), profile, resume, changes: suggestions, analysis, editInput, jobTitle, company, pdf: null });
  sendJson(res, 200, { analysisId: id, analysis, resumeTitle: resume.title, changes: publicChanges(suggestions), warning });
}

async function refine(req, res) {
  const body = await readJson(req);
  const session = sessionFor(body.analysisId);
  try {
    const rawEdits = await provider.suggestEdits(session.editInput);
    const suggestions = validateSuggestions(rawEdits?.suggested_changes, session.analysis, session.profile, session.resume);
    if (!suggestions.length) return sendJson(res, 200, { changes: publicChanges(session.changes), warning: 'Qwen proposed no valid changes. Your existing suggestions are unchanged.', replaced: false });
    session.changes = combineSuggestions(suggestions, session.changes);
    session.pdf = null;
    return sendJson(res, 200, { changes: publicChanges(session.changes), warning: '', replaced: true });
  } catch {
    return sendJson(res, 200, { changes: publicChanges(session.changes), warning: 'Qwen refinement did not finish. Your existing suggestions are unchanged.', replaced: false });
  }
}

async function compile(req, res) {
  const body = await readJson(req);
  const session = sessionFor(body.analysisId);
  const decisions = body.decisions;
  if (!Array.isArray(decisions) || decisions.length !== session.changes.length || decisions.some(x => typeof x?.approved !== 'boolean') || !session.changes.every(c => decisions.some(d => d.id === c.id))) throw new Error('Approve or reject every suggested change before compiling.');
  const approvedIds = decisions.filter(x => x.approved).map(x => x.id);
  const tailored = applyApproved(session.resume, session.changes, approvedIds);
  const pdf = await compileResume(session.profile, tailored, { jobTitle: session.jobTitle, company: session.company });
  session.pdf = pdf;
  sendJson(res, 200, { filename: pdf.filename, pages: pdf.pages, previewUrl: `/api/pdf/${body.analysisId}`, downloadUrl: `/api/download/${body.analysisId}` });
}

async function servePdf(res, id, download) {
  const session = sessionFor(id);
  if (!session.pdf) throw new Error('Compile the resume first.');
  const data = await readFile(session.pdf.path);
  res.writeHead(200, { 'Content-Type': 'application/pdf', 'Content-Length': data.length, 'Content-Disposition': `${download ? 'attachment' : 'inline'}; filename="${session.pdf.filename}"`, 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' });
  res.end(data);
}

const staticFiles = { '/': ['index.html', 'text/html'], '/app.js': ['app.js', 'text/javascript'], '/styles.css': ['styles.css', 'text/css'] };

const server = http.createServer(async (req, res) => {
  try {
    const url = new URL(req.url, 'http://localhost');
    if (req.method === 'GET' && staticFiles[url.pathname]) {
      const [filename, mime] = staticFiles[url.pathname];
      const data = await readFile(path.join(root, 'public', filename));
      res.writeHead(200, { 'Content-Type': `${mime}; charset=utf-8`, 'Content-Length': data.length, 'Cache-Control': 'no-store' });
      return res.end(data);
    }
    if (req.method === 'GET' && url.pathname === '/api/status') {
      const { profile, resumes } = await loadData();
      return sendJson(res, 200, { configured: isConfigured(profile, resumes), provider: 'Kyma · Qwen 3.8 Flash', keyConfigured: Boolean(process.env.KYMA_API_KEY), resumes: Object.values(resumes).map(({ id, title }) => ({ id, title })) });
    }
    if (req.method === 'POST' && url.pathname === '/api/analyze') return await analyze(req, res);
    if (req.method === 'POST' && url.pathname === '/api/refine') return await refine(req, res);
    if (req.method === 'POST' && url.pathname === '/api/compile') return await compile(req, res);
    const pdfRoute = url.pathname.match(/^\/api\/(pdf|download)\/([0-9a-f-]{36})$/);
    if (req.method === 'GET' && pdfRoute) return await servePdf(res, pdfRoute[2], pdfRoute[1] === 'download');
    sendJson(res, 404, { error: 'Not found' });
  } catch (error) {
    const message = String(error?.message ?? error).replaceAll(process.env.KYMA_API_KEY || '\0', '[redacted]');
    sendJson(res, /Invalid|must |expired|Approve|Paste|not configured|No LaTeX|pages|Compile the resume/.test(message) ? 400 : 500, { error: message });
  }
});

const port = Number(process.env.PORT || 3001);
server.listen(port, '127.0.0.1', () => console.log(`Resume Tailor running at http://127.0.0.1:${port}`));
