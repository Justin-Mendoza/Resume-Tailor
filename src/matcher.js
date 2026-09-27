import { RESUME_IDS } from './data.js';

export function normalize(text) {
  return String(text).toLowerCase().replace(/[^\p{L}\p{N}+#.]+/gu, ' ').trim().replace(/\s+/g, ' ');
}

export function containsTerm(haystack, needle) {
  const h = ` ${normalize(haystack)} `;
  const n = normalize(needle);
  return !!n && h.includes(` ${n} `);
}

function skillForKeyword(keyword, profile) {
  return profile.skills.find(skill => [skill.label, ...(skill.aliases ?? [])].some(term => normalize(term) === normalize(keyword)));
}

function displayedText(profile, resume) {
  const skills = resume.skillGroups.flatMap(g => g.skillIds).map(id => profile.skills.find(s => s.id === id)?.label ?? '');
  const projectTech = (resume.projects ?? []).flatMap(sel => sel.techSkillIds ?? []).map(id => profile.skills.find(s => s.id === id)?.label ?? '');
  const headings = (resume.experience ?? []).map(sel => profile.experience.find(e => e.id === sel.entryId)?.titleVariants[sel.titleVariant] ?? '');
  const bullets = ['experience', 'projects'].flatMap(section => (resume[section] ?? []).flatMap(sel => {
    const entry = profile[section].find(e => e.id === sel.entryId);
    return (sel.bulletIds ?? []).map(id => {
      const bullet = entry?.bullets.find(b => b.id === id);
      const variant = resume.variants?.[`${section}:${sel.entryId}:${id}`];
      return variant === undefined ? bullet?.text ?? '' : bullet?.variants?.[variant] ?? '';
    });
  }));
  const education = (resume.education ?? []).flatMap(sel => profile.education.find(e => e.id === sel.entryId)?.details ?? []);
  return [...skills, ...projectTech, ...headings, ...bullets, ...education].join(' | ');
}

export function analyzeMatches(jd, raw, profile, resumes) {
  const seen = new Set();
  const keywords = (raw.important_keywords ?? []).filter(x => typeof x === 'string' && containsTerm(jd, x)).filter(x => {
    const n = normalize(x);
    if (seen.has(n)) return false;
    seen.add(n);
    return true;
  }).slice(0, 30);
  const scores = Object.fromEntries(RESUME_IDS.map(id => {
    const text = displayedText(profile, resumes[id]);
    const score = keywords.filter(k => {
      const skill = skillForKeyword(k, profile);
      return skill && [skill.label, ...(skill.aliases ?? [])].some(alias => containsTerm(text, alias));
    }).length;
    return [id, score];
  }));
  const ranked = [...RESUME_IDS].sort((a, b) => scores[b] - scores[a]);
  const recommended = RESUME_IDS.includes(raw.recommended_resume) && scores[raw.recommended_resume] === scores[ranked[0]] ? raw.recommended_resume : ranked[0];
  const current = displayedText(profile, resumes[recommended]);
  const matched = [], missing = [], unsupported = [];
  for (const keyword of keywords) {
    const skill = skillForKeyword(keyword, profile);
    if (!skill) unsupported.push(keyword);
    else if ([skill.label, ...(skill.aliases ?? [])].some(alias => containsTerm(current, alias))) matched.push(keyword);
    else missing.push(keyword);
  }
  return { recommended_resume: recommended, job_category: String(raw.job_category ?? 'software_engineering').slice(0, 80), important_keywords: keywords, matched_keywords: matched, missing_but_verified: missing, unsupported_keywords: unsupported, scores };
}
