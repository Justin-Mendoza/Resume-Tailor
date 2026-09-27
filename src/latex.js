import { readFile } from 'node:fs/promises';
import path from 'node:path';

const root = path.resolve(import.meta.dirname, '..');

export function escapeLatex(value) {
  return String(value).replace(/[\\{}$&#%_~^]/g, char => ({
    '\\': '\\textbackslash{}', '{': '\\{', '}': '\\}', '$': '\\$', '&': '\\&', '#': '\\#', '%': '\\%', '_': '\\_', '~': '\\textasciitilde{}', '^': '\\textasciicircum{}'
  })[char]);
}

function formatText(text, emphasis = []) {
  const matches = [];
  for (const term of [...new Set(emphasis)].filter(Boolean)) {
    let from = 0;
    while (from < text.length) {
      const start = text.indexOf(term, from);
      if (start < 0) break;
      matches.push({ start, end: start + term.length, term });
      from = start + term.length;
    }
  }
  matches.sort((a, b) => a.start - b.start || b.end - a.end);
  let cursor = 0;
  let output = '';
  for (const match of matches) {
    if (match.start < cursor) continue;
    output += escapeLatex(text.slice(cursor, match.start));
    output += `\\textbf{${escapeLatex(match.term)}}`;
    cursor = match.end;
  }
  return output + escapeLatex(text.slice(cursor));
}

function roleAndStack(title) {
  const match = String(title).match(/^(.*?)(\s+\([^()]*\))$/);
  return match ? { role: match[1], stack: match[2].trim() } : { role: title, stack: '' };
}

function heading(text) { return `\\resumeSection{${escapeLatex(text)}}\n`; }

function bulletList(profile, section, entry, bulletIds, resume) {
  if (!bulletIds?.length) return '';
  let out = '\\resumeItemListStart\n';
  for (const id of bulletIds) {
    const bullet = entry.bullets.find(x => x.id === id);
    const variant = resume.variants?.[`${section}:${entry.id}:${id}`];
    const text = variant === undefined ? bullet.text : bullet.variants[variant];
    out += `\\resumeItem{${formatText(text, bullet.emphasis)}}\n`;
  }
  return out + '\\resumeItemListEnd\n';
}

function renderHeader(identity) {
  const links = (identity.links ?? []).map((label, index) => `\\underline{\\href{${identity.linkUrls[index]}}{${escapeLatex(label)}}}`);
  const contact = [escapeLatex(identity.phone), `\\underline{\\href{mailto:${identity.email}}{${escapeLatex(identity.email)}}}`, ...links].filter(Boolean).join(' $\\vert$ ');
  return `\\begin{center}\n{\\Huge \\textbf{${escapeLatex(identity.name)}}} \\\\ \\vspace{4pt}\n\\small ${contact}\n\\end{center}\n\\vspace{-8pt}\n`;
}

function renderExperience(profile, resume) {
  if (!resume.experience.length) return '';
  let out = heading('Experience') + '\\resumeSubHeadingListStart\n';
  for (const selected of resume.experience) {
    const entry = profile.experience.find(e => e.id === selected.entryId);
    const { role, stack } = roleAndStack(entry.titleVariants[selected.titleVariant]);
    out += `\\resumeSubheading{${escapeLatex(entry.company)}}{${escapeLatex(entry.location ?? '')}}{${escapeLatex(role)}}{${escapeLatex(stack)}}{${escapeLatex(entry.dates)}}\n`;
    out += bulletList(profile, 'experience', entry, selected.bulletIds, resume);
  }
  return out + '\\resumeSubHeadingListEnd\n';
}

function renderProjects(profile, resume) {
  if (!resume.projects.length) return '';
  let out = heading('Projects') + '\\resumeSubHeadingListStart\n';
  for (const selected of resume.projects) {
    const entry = profile.projects.find(e => e.id === selected.entryId);
    const name = entry.nameVariants[selected.nameVariant];
    const title = `${escapeLatex(name)} \\underline{\\href{${entry.url}}{(GitHub)}}`;
    const tech = selected.techSkillIds.map(id => profile.skills.find(s => s.id === id).label).join(', ');
    out += `\\resumeProject{${title}}{${escapeLatex(tech)}}\n`;
    out += bulletList(profile, 'projects', entry, selected.bulletIds, resume);
  }
  return out + '\\resumeSubHeadingListEnd\n';
}

function renderSkills(profile, resume) {
  if (!resume.skillGroups.length) return '';
  let out = heading('Technical Skills') + '\\resumeSubHeadingListStart\n\\item{\\small\n';
  for (const group of resume.skillGroups) {
    const values = group.skillIds.map(id => profile.skills.find(s => s.id === id).label).join(', ');
    out += `\\resumeSkill{${escapeLatex(group.label)}}{${escapeLatex(values)}}\n`;
  }
  return out + '}\n\\resumeSubHeadingListEnd\n\\vspace{-14pt}\n';
}

function renderEducation(profile, resume) {
  if (!resume.education.length) return '';
  let out = heading('Education') + '\\resumeSubHeadingListStart\n';
  for (const selected of resume.education) {
    const entry = profile.education.find(e => e.id === selected.entryId);
    out += `\\resumeSubheading{${escapeLatex(entry.school)}}{${escapeLatex(entry.location ?? '')}}{${escapeLatex(entry.degree)}}{}{${escapeLatex(entry.dates)}}\n`;
    if (entry.details?.length) {
      out += '\\resumeItemListStart\n';
      entry.details.forEach((detail, index) => out += `\\resumeItem{${formatText(detail, entry.detailEmphasis?.[index])}}\n`);
      out += '\\resumeItemListEnd\n';
    }
  }
  return out + '\\resumeSubHeadingListEnd\n';
}

export async function renderLatex(profile, resume) {
  const template = await readFile(path.join(root, 'templates', `${resume.id}.tex`), 'utf8');
  const marker = '%%RESUME_CONTENT%%';
  if (template.split(marker).length !== 2) throw new Error(`Template ${resume.id} must contain one content marker`);
  const content = renderHeader(profile.identity) + renderExperience(profile, resume) + renderProjects(profile, resume) + renderSkills(profile, resume) + renderEducation(profile, resume);
  return template.replace(marker, content);
}
