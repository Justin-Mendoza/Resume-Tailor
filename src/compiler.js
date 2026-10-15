import { spawn } from 'node:child_process';
import { mkdtemp, writeFile, readFile, copyFile, mkdir, rm, access } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { renderLatex } from './latex.js';
import { validatePdfText } from './pdf-validation.js';

const root = path.resolve(import.meta.dirname, '..');

function run(command, args, cwd, timeout = 30000) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { cwd, env: process.env });
    let output = '';
    const timer = setTimeout(() => { child.kill('SIGKILL'); reject(new Error(`${command} timed out`)); }, timeout);
    const add = chunk => { output = (output + chunk.toString()).slice(-30000); };
    child.stdout.on('data', add);
    child.stderr.on('data', add);
    child.on('error', error => { clearTimeout(timer); reject(error); });
    child.on('close', code => { clearTimeout(timer); resolve({ code, output }); });
  });
}

async function commandExists(command) {
  try { const result = await run('which', [command], root, 3000); return result.code === 0; }
  catch { return false; }
}

async function pageCount(pdfPath) {
  if (await commandExists('pdfinfo')) {
    const result = await run('pdfinfo', [pdfPath], root);
    const match = result.output.match(/^Pages:\s+(\d+)/m);
    if (match) return Number(match[1]);
  }
  if (process.platform === 'darwin' && await commandExists('osascript')) {
    const script = 'ObjC.import("PDFKit"); function run(argv) { var d=$.PDFDocument.alloc.initWithURL($.NSURL.fileURLWithPath(argv[0])); return d.pageCount; }';
    const result = await run('osascript', ['-l', 'JavaScript', '-e', script, pdfPath], root);
    const match = result.output.match(/^(\d+)\s*$/m);
    if (result.code === 0 && match) return Number(match[1]);
  }
  return null;
}

async function extractPdfText(pdfPath) {
  if (await commandExists('pdftotext')) {
    const result = await run('pdftotext', ['-enc', 'UTF-8', pdfPath, '-'], root);
    if (result.code === 0) return { text: result.output, engine: 'Poppler' };
  }
  if (process.platform === 'darwin') {
    const script = 'ObjC.import("PDFKit"); function run(argv) { var d=$.PDFDocument.alloc.initWithURL($.NSURL.fileURLWithPath(argv[0])); return ObjC.unwrap(d.string); }';
    const result = await run('osascript', ['-l', 'JavaScript', '-e', script, pdfPath], root);
    if (result.code === 0) return { text: result.output, engine: 'PDFKit' };
  }
  throw new Error('PDF text extraction unavailable. Install Poppler (pdftotext) to validate parsing before export.');
}

export function outputFilename(name, company, jobTitle) {
  const clean = text => String(text ?? '').normalize('NFKD').replace(/[^A-Za-z0-9]+/g, '_').replace(/^_+|_+$/g, '').slice(0, 60);
  return [clean(name), clean(company), clean(jobTitle)].filter(Boolean).join('_') + '.pdf';
}

export async function compileResume(profile, resume, { company, jobTitle, keywords = [] }) {
  const latex = await renderLatex(profile, resume);
  const buildDir = await mkdtemp(path.join(tmpdir(), 'resume-tailor-'));
  try {
    await writeFile(path.join(buildDir, 'resume.tex'), latex, 'utf8');
    const macTex = '/Library/TeX/texbin';
    const hasLatexmk = await commandExists('latexmk');
    const hasPdflatex = await commandExists('pdflatex');
    const macLatexmk = !hasLatexmk && await access(path.join(macTex, 'latexmk')).then(() => true, () => false);
    const macPdflatex = !hasPdflatex && await access(path.join(macTex, 'pdflatex')).then(() => true, () => false);
    if (!hasLatexmk && !hasPdflatex && !macLatexmk && !macPdflatex) throw new Error('No LaTeX compiler found. Install latexmk or pdflatex (for example, MacTeX BasicTeX), then try again.');
    const command = hasLatexmk ? 'latexmk' : macLatexmk ? path.join(macTex, 'latexmk') : hasPdflatex ? 'pdflatex' : path.join(macTex, 'pdflatex');
    const args = hasLatexmk || macLatexmk ? ['-pdf', '-no-shell-escape', '-interaction=nonstopmode', '-halt-on-error', 'resume.tex'] : ['-no-shell-escape', '-interaction=nonstopmode', '-halt-on-error', 'resume.tex'];
    const result = await run(command, args, buildDir, 60000);
    if (result.code !== 0) throw new Error(`LaTeX compilation failed:\n${result.output.slice(-7000)}`);
    const pdfPath = path.join(buildDir, 'resume.pdf');
    await access(pdfPath).catch(() => { throw new Error(`LaTeX exited successfully but no PDF was produced:\n${result.output.slice(-4000)}`); });
    const pages = await pageCount(pdfPath);
    if (pages === null) throw new Error('Cannot verify one-page output. Install pdfinfo or enable PDFKit before export.');
    if (pages !== 1) throw new Error(`The tailored resume is ${pages} pages. Reject lengthening edits or shorten less relevant content before saving.`);
    const extracted = await extractPdfText(pdfPath);
    const validation = { ...validatePdfText(extracted.text, profile, resume, keywords), engine: extracted.engine, pages, layoutWarnings: result.output.split('\n').filter(line => /Overfull \\[hv]box/.test(line)) };
    if (!validation.passed) throw new Error(`PDF parsing validation failed: ${validation.errors.join('; ')}`);
    if (validation.layoutWarnings.length) throw new Error(`PDF layout validation failed: ${validation.layoutWarnings.join('; ')}`);
    const outputDir = path.join(root, 'output', 'pdf');
    await mkdir(outputDir, { recursive: true });
    const base = outputFilename(profile.identity.name, company, jobTitle);
    let filename = base, index = 2;
    while (await access(path.join(outputDir, filename)).then(() => true, () => false)) {
      filename = base.replace(/\.pdf$/, `_${index++}.pdf`);
    }
    const finalPath = path.join(outputDir, filename);
    await copyFile(pdfPath, finalPath);
    const buffer = await readFile(finalPath);
    if (buffer.subarray(0, 4).toString() !== '%PDF') throw new Error('Compiler output is not a valid PDF');
    const latexPath = finalPath.replace(/\.pdf$/, '.tex');
    const reportPath = finalPath.replace(/\.pdf$/, '.report.json');
    await writeFile(latexPath, latex, 'utf8');
    await writeFile(finalPath.replace(/\.pdf$/, '.txt'), extracted.text, 'utf8');
    return { filename, pages, path: finalPath, latexPath, reportPath, validation };
  } finally {
    await rm(buildDir, { recursive: true, force: true });
  }
}
