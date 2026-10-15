import test from 'node:test';
import assert from 'node:assert/strict';
import { access, readFile, rm } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
import { loadData } from '../src/data.js';
import { compileResume } from '../src/compiler.js';
import { analyzeMatches } from '../src/matcher.js';
import { reviewRewrites } from '../src/rewrite-validation.js';
import { validateSuggestions, applyApproved, fallbackSuggestions } from '../src/editor.js';

const available = command => spawnSync('which', [command]).status === 0;
const hasCompiler = available('pdflatex') || available('latexmk') || await access('/Library/TeX/texbin/pdflatex').then(() => true, () => false);
const hasExtraction = process.platform === 'darwin' || (available('pdftotext') && available('pdfinfo'));

test('all templates and an approved aggressive rewrite compile to one-page searchable PDFs', { skip: !hasCompiler || !hasExtraction ? 'Requires LaTeX and Poppler or macOS PDFKit' : false }, async () => {
  const { profile, resumes } = await loadData();
  const analysis = analyzeMatches('Kafka', { requirements: [{ keyword: 'Kafka', source: 'Kafka', category: 'required_technical_skill', priority: 'critical' }] }, profile, resumes);
  const raw = { operation: 'bullet_rewrite', section: 'projects', targetId: 'video', itemId: 'video_services', sourceBulletIds: ['video_services'], proposed: 'Engineered fault-tolerant ingestion and delivery with independent producer and consumer services, buffering metrics in Kafka during downstream outages.', reason: 'Surface demonstrated resilience.', jdKeyword: 'Kafka', confidence: 0.95 };
  const provider = { reviewEdits: async ({ candidates }) => ({ reviews: candidates.map(c => ({ id: c.id, supported: true, improves: true, unsupportedClaims: [], reason: 'Outage buffering supports resilience wording.' })) }) };
  const { reviews } = await reviewRewrites(provider, [raw], analysis, profile, resumes.backend_infra);
  const changes = validateSuggestions([raw], analysis, profile, resumes.backend_infra, reviews);
  assert.equal(changes.length, 1);
  const tailored = applyApproved(resumes.backend_infra, changes, changes.map(c => c.id));
  const orderingRows = ['Python/Django or Go or similar backend technologies', 'Relational databases and transaction-safe design'].map(keyword => ({ keyword, source: keyword, priority: 'critical', category: 'required_technical_skill' }));
  const orderingAnalysis = analyzeMatches(orderingRows.map(r => r.source).join('\n'), { requirements: orderingRows }, profile, resumes);
  const orderingChanges = fallbackSuggestions(orderingAnalysis, profile, resumes.backend_infra);
  const ordered = applyApproved(resumes.backend_infra, orderingChanges, orderingChanges.map(c => c.id));
  for (const resume of [...Object.values(resumes), tailored, ordered]) {
    const pdf = await compileResume(profile, resume, { company: 'Automated Test', jobTitle: `Compilation ${process.pid}`, keywords: ['Kafka', 'Go', 'Kubernetes'] });
    try {
      assert.equal(pdf.pages, 1);
      assert.equal(pdf.validation.passed, true);
      assert.deepEqual(pdf.validation.layoutWarnings, []);
      const text = await readFile(pdf.path.replace(/\.pdf$/, '.txt'), 'utf8');
      if (resume === tailored) assert.ok(text.replace(/\s+/g, ' ').includes(raw.proposed));
      if (resume === ordered) {
        assert.ok(text.indexOf('Implemented PostgreSQL transactions') < text.indexOf('Improved search relevance'));
        assert.ok(text.indexOf('Backend & Data:') < text.indexOf('Infrastructure:'));
      }
    } finally {
      for (const filename of [pdf.path, pdf.latexPath, pdf.path.replace(/\.pdf$/, '.txt')]) await rm(filename, { force: true });
    }
  }
});
