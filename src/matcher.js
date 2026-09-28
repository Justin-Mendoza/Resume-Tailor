import { RESUME_IDS } from './data.js';

export function normalize(text) {
  return String(text).toLowerCase()
    .replace(/(?<![\p{L}\p{N}])\.|\.(?![\p{L}\p{N}])/gu, ' ')
    .replace(/[^\p{L}\p{N}+#.]+/gu, ' ').trim().replace(/\s+/g, ' ');
}

export function containsTerm(haystack, needle) {
  const h = ` ${normalize(haystack)} `;
  const n = normalize(needle);
  return !!n && h.includes(` ${n} `);
}

function appearsInJD(jd, term) {
  // Short language/acronym names should not match ordinary prose (for example,
  // the verb "go" is not evidence that a posting asks for Go).
  if (/^\p{L}{2,3}$/u.test(term)) {
    const escaped = term.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    return new RegExp(`(?<![\\p{L}\\p{N}])${escaped}(?![\\p{L}\\p{N}])`, 'u').test(jd);
  }
  return containsTerm(jd, term);
}

function skillForKeyword(keyword, profile) {
  return profile.skills.find(skill => [skill.label, ...(skill.aliases ?? [])].some(term => normalize(term) === normalize(keyword)));
}

function verifiedText(profile) {
  return [
    ...profile.skills.flatMap(skill => [skill.label, ...(skill.aliases ?? [])]),
    ...profile.experience.flatMap(entry => [...entry.titleVariants, ...entry.bullets.flatMap(bullet => [bullet.text, ...(bullet.variants ?? [])])]),
    ...profile.projects.flatMap(entry => [...entry.nameVariants, ...entry.bullets.flatMap(bullet => [bullet.text, ...(bullet.variants ?? [])])]),
    ...profile.education.flatMap(entry => [entry.degree, ...(entry.details ?? [])])
  ].join(' | ');
}

function jdKeywords(jd, rawKeywords, profile) {
  const keywords = [], seenTerms = new Set(), seenSkills = new Set();
  const add = term => {
    if (typeof term !== 'string' || !appearsInJD(jd, term)) return;
    const normalized = normalize(term);
    const skill = skillForKeyword(term, profile);
    if (!normalized || seenTerms.has(normalized) || (skill && seenSkills.has(skill.id))) return;
    seenTerms.add(normalized);
    if (skill) seenSkills.add(skill.id);
    keywords.push(term);
  };
  for (const term of Array.isArray(rawKeywords) ? rawKeywords : []) add(term);
  for (const skill of profile.skills) {
    const term = [skill.label, ...(skill.aliases ?? [])].find(alias => appearsInJD(jd, alias));
    if (term) add(term);
  }
  return keywords.slice(0, 80);
}

function displayedText(profile, resume) {
  const skills = resume.skillGroups.flatMap(g => g.skillIds).map(id => profile.skills.find(s => s.id === id)?.label ?? '');
  const projectTech = (resume.projects ?? []).flatMap(sel => sel.techSkillIds ?? []).map(id => profile.skills.find(s => s.id === id)?.label ?? '');
  const headings = (resume.experience ?? []).map(sel => profile.experience.find(e => e.id === sel.entryId)?.titleVariants[sel.titleVariant] ?? '');
  const projectNames = (resume.projects ?? []).map(sel => profile.projects.find(e => e.id === sel.entryId)?.nameVariants[sel.nameVariant] ?? '');
  const bullets = ['experience', 'projects'].flatMap(section => (resume[section] ?? []).flatMap(sel => {
    const entry = profile[section].find(e => e.id === sel.entryId);
    return (sel.bulletIds ?? []).map(id => {
      const bullet = entry?.bullets.find(b => b.id === id);
      const variant = resume.variants?.[`${section}:${sel.entryId}:${id}`];
      return variant === undefined ? bullet?.text ?? '' : bullet?.variants?.[variant] ?? '';
    });
  }));
  const education = (resume.education ?? []).flatMap(sel => profile.education.find(e => e.id === sel.entryId)?.details ?? []);
  return [...skills, ...projectTech, ...headings, ...projectNames, ...bullets, ...education].join(' | ');
}

function displayedSkills(profile, resume) {
  return resume.skillGroups.flatMap(group => group.skillIds)
    .map(id => profile.skills.find(skill => skill.id === id)?.label ?? '').join(' | ');
}

export function analyzeMatches(jd, raw, profile, resumes) {
  const keywords = jdKeywords(jd, raw.important_keywords, profile);
  const scores = Object.fromEntries(RESUME_IDS.map(id => {
    const text = displayedText(profile, resumes[id]);
    const score = keywords.filter(keyword => containsTerm(text, keyword) || [skillForKeyword(keyword, profile)].filter(Boolean).some(skill => [skill.label, ...(skill.aliases ?? [])].some(alias => containsTerm(text, alias)))).length;
    return [id, score];
  }));
  const ranked = [...RESUME_IDS].sort((a, b) => scores[b] - scores[a]);
  const recommended = RESUME_IDS.includes(raw.recommended_resume) && scores[raw.recommended_resume] === scores[ranked[0]] ? raw.recommended_resume : ranked[0];
  const current = displayedText(profile, resumes[recommended]);
  const skillsText = displayedSkills(profile, resumes[recommended]);
  const matched = [], missing = [], missingFromSkills = [], unsupported = [], exactMatched = [], aliasOnly = [];
  const allVerified = verifiedText(profile);
  for (const keyword of keywords) {
    const skill = skillForKeyword(keyword, profile);
    const exact = containsTerm(current, keyword);
    const equivalent = !exact && skill && [skill.label, ...(skill.aliases ?? [])].some(alias => containsTerm(current, alias));
    if (exact) { matched.push(keyword); exactMatched.push(keyword); }
    else if (equivalent) { matched.push(keyword); aliasOnly.push(keyword); }
    else if (skill || containsTerm(allVerified, keyword)) missing.push(keyword);
    else unsupported.push(keyword);
    const hasCompatibleGroup = skill?.categories?.some(category => resumes[recommended].skillGroups.some(group => group.label === category));
    if (skill && hasCompatibleGroup && ![skill.label, ...(skill.aliases ?? [])].some(alias => containsTerm(skillsText, alias))) missingFromSkills.push(keyword);
  }
  return { recommended_resume: recommended, job_category: String(raw.job_category ?? 'software_engineering').slice(0, 80), important_keywords: keywords, matched_keywords: matched, exact_keywords: exactMatched, equivalent_keywords: aliasOnly, missing_but_verified: missing, missing_from_skills: missingFromSkills, unsupported_keywords: unsupported, coverage: { total: keywords.length, exact_on_resume: exactMatched.length, equivalent_on_resume: aliasOnly.length, verified_not_on_resume: missing.length, unsupported: unsupported.length, verified_in_jd: keywords.length - unsupported.length, desired_minimum: 27, desired_maximum: 34 }, scores };
}
