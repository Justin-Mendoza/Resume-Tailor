import { readFile } from 'node:fs/promises';
import path from 'node:path';

const root = path.resolve(import.meta.dirname, '..');

export function escapeLatex(value) {
  return String(value).replace(/[\\{}$&#%_~^]/g, char => ({
    '\\': '\\textbackslash{}', '{': '\\{', '}': '\\}', '$': '\\$', '&': '\\&', '#': '\\#', '%': '\\%', '_': '\\_', '~': '\\textasciitilde{}', '^': '\\textasciicircum{}'
  })[char]);
}

const line = text => `${text}\n`;
const heading = text => `\\vspace{3pt}\\textbf{${escapeLatex(text)}}\\par\\hrule\\vspace{2pt}\n`;
const bullets = items => items.length ? `\\begin{list}{\\textbullet}{\\setlength{\\leftmargin}{1.2em}\\setlength{\\labelsep}{0.4em}\\setlength{\\itemsep}{0pt}\\setlength{\\topsep}{1pt}\\setlength{\\parsep}{0pt}}\n${items.map(x => `\\item ${escapeLatex(x)}`).join('\n')}\n\\end{list}\n` : '';

function renderHeader(identity) {
  const links = (identity.links ?? []).map((label, index) => `\\href{${identity.linkUrls[index]}}{\\underline{${escapeLatex(label)}}}`);
  const contact = [escapeLatex(identity.phone), `\\href{mailto:${identity.email}}{${escapeLatex(identity.email)}}`, ...links].filter(Boolean).join(' $\\vert$ ');
  return line(`{\\centering\\fontsize{22}{23}\\selectfont\\textbf{${escapeLatex(identity.name)}}\\par}`) + line(`{\\centering ${contact}\\par}`) + '\\vspace{8pt}\n';
}

function renderExperience(profile, resume) {
  if (!resume.experience.length) return '';
  let out = heading('Experience');
  for (const selected of resume.experience) {
    const entry = profile.experience.find(e => e.id === selected.entryId);
    out += line(`\\textbf{${escapeLatex(entry.company)}}\\hfill ${escapeLatex(entry.location ?? '')}\\\\`);
    out += line(`\\textit{${escapeLatex(entry.titleVariants[selected.titleVariant])}}\\hfill ${escapeLatex(entry.dates)}\\par`);
    out += bullets(selected.bulletIds.map(id => {
      const b = entry.bullets.find(x => x.id === id);
      const index = resume.variants?.[`experience:${entry.id}:${id}`];
      return index === undefined ? b.text : b.variants[index];
    }));
  }
  return out;
}

function renderProjects(profile, resume) {
  if (!resume.projects.length) return '';
  let out = heading('Projects');
  for (const selected of resume.projects) {
    const entry = profile.projects.find(e => e.id === selected.entryId);
    const tech = selected.techSkillIds.map(id => profile.skills.find(s => s.id === id).label).join(', ');
    out += line(`\\textbf{${escapeLatex(entry.nameVariants[selected.nameVariant])}} \\href{${entry.url}}{\\underline{(GitHub)}} $\\vert$ ${escapeLatex(tech)}\\par`);
    out += bullets(selected.bulletIds.map(id => {
      const b = entry.bullets.find(x => x.id === id);
      const index = resume.variants?.[`projects:${entry.id}:${id}`];
      return index === undefined ? b.text : b.variants[index];
    }));
  }
  return out;
}

function renderSkills(profile, resume) {
  if (!resume.skillGroups.length) return '';
  let out = heading('Technical Skills');
  for (const group of resume.skillGroups) {
    const values = group.skillIds.map(id => profile.skills.find(s => s.id === id).label).join(', ');
    out += line(`\\textbf{${escapeLatex(group.label)}:} ${escapeLatex(values)}\\par`);
  }
  return out;
}

function renderEducation(profile, resume) {
  if (!resume.education.length) return '';
  let out = heading('Education');
  for (const selected of resume.education) {
    const entry = profile.education.find(e => e.id === selected.entryId);
    out += line(`\\textbf{${escapeLatex(entry.school)}}\\hfill ${escapeLatex(entry.location ?? '')}\\\\`);
    out += line(`${escapeLatex(entry.degree)}\\hfill ${escapeLatex(entry.dates)}\\par`);
    out += bullets(entry.details ?? []);
  }
  return out;
}

export async function renderLatex(profile, resume) {
  const template = await readFile(path.join(root, 'templates', `${resume.id}.tex`), 'utf8');
  const marker = '%%RESUME_CONTENT%%';
  if (template.split(marker).length !== 2) throw new Error(`Template ${resume.id} must contain one content marker`);
  const content = renderHeader(profile.identity) + renderExperience(profile, resume) + renderProjects(profile, resume) + renderSkills(profile, resume) + renderEducation(profile, resume);
  return template.replace(marker, content);
}
