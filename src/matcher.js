import { RESUME_IDS } from './data.js';

export function normalize(text) {
  return String(text).normalize('NFKC').toLowerCase().replace(/[^\p{L}\p{N}+#.]+/gu, ' ').trim().replace(/\s+/g, ' ');
}

export function containsTerm(haystack, needle) {
  const h = ` ${normalize(haystack).replace(/\.(?= |$)/g, ' ')} `;
  const n = normalize(needle);
  return !!n && h.includes(` ${n} `);
}

function skillForKeyword(keyword, profile) {
  return profile.skills.find(skill => [skill.label, ...(skill.aliases ?? [])].some(term => normalize(term) === normalize(keyword)));
}

export function displayedText(profile, resume) {
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
  const education = (resume.education ?? []).flatMap(sel => { const entry = profile.education.find(e => e.id === sel.entryId); return entry ? [entry.school, entry.degree, entry.dates, ...(entry.details ?? [])] : []; });
  return [...skills, ...projectTech, ...headings, ...bullets, ...education].join(' | ');
}

function displayedSkills(profile, resume) {
  return resume.skillGroups.flatMap(group => group.skillIds)
    .map(id => profile.skills.find(skill => skill.id === id)?.label ?? '').join(' | ');
}

const categories = new Set(['required_technical_skill', 'preferred_technical_skill', 'core_responsibility', 'domain_experience', 'other_qualification']);
const priorityValue = { high: 3, medium: 2, low: 1 };

// Only curated aliases authorize terminology changes. Model synonyms remain advisory.
export function extractRequirements(jd, raw, profile) {
  const rows = Array.isArray(raw.requirements) ? raw.requirements : (raw.important_keywords ?? []).map(keyword => ({ keyword, source: keyword, priority: 'medium', category: 'required_technical_skill' }));
  const result = [];
  for (const row of rows.slice(0, 100)) {
    if (typeof row?.keyword !== 'string' || typeof row.source !== 'string' || !row.keyword.trim() || !row.source.trim() || !jd.includes(row.source)) continue;
    const skill = skillForKeyword(row.keyword, profile);
    const sourceTerms = skill ? [row.keyword, skill.label, ...(skill.aliases ?? [])] : [row.keyword];
    if (['required_technical_skill', 'preferred_technical_skill'].includes(row.category) && !sourceTerms.some(term => containsTerm(row.source, term))) continue;
    const key = skill && !skill.label.includes('/') ? skill.id : normalize(row.keyword);
    const requirement = { keyword: row.keyword.trim().slice(0, 160), aliases: Array.isArray(row.aliases) ? row.aliases.filter(x => typeof x === 'string').slice(0, 10) : [], category: categories.has(row.category) ? row.category : 'other_qualification', priority: row.category === 'required_technical_skill' ? 'high' : row.category === 'preferred_technical_skill' ? 'medium' : priorityValue[row.priority] ? row.priority : 'medium', source: row.source, key, semanticEvidence: Array.isArray(row.evidence) ? row.evidence : [] };
    const existing = result.find(x => x.key === key);
    if (!existing) result.push(requirement);
    else if (priorityValue[requirement.priority] > priorityValue[existing.priority]) Object.assign(existing, requirement);
  }
  return result.sort((a, b) => priorityValue[b.priority] - priorityValue[a.priority]);
}

export function evidenceCatalog(profile, resume) {
  const items = [];
  for (const section of ['experience', 'projects']) for (const selected of resume[section] ?? []) {
    const entry = profile[section].find(x => x.id === selected.entryId);
    for (const id of selected.bulletIds) {
      const bullet = entry.bullets.find(x => x.id === id);
      const variant = resume.variants?.[`${section}:${entry.id}:${id}`];
      items.push({ id: `${section}:${entry.id}:${id}`, text: variant === undefined ? bullet.text : bullet.variants[variant], originalText: bullet.text, skillIds: bullet.skillIds ?? [] });
    }
  }
  return items;
}

function matchRequirement(requirement, profile, resume) {
  const skill = skillForKeyword(requirement.keyword, profile);
  const text = displayedText(profile, resume);
  const terms = skill && skill.label.includes('/') ? [requirement.keyword] : skill ? [skill.label, ...(skill.aliases ?? [])] : [requirement.keyword];
  const bullets = evidenceCatalog(profile, resume);
  const direct = bullets.filter(b => containsTerm(b.text, requirement.keyword));
  const equivalent = bullets.filter(b => terms.some(t => containsTerm(b.text, t)) || (skill && b.skillIds.includes(skill.id)));
  // Semantic evidence must quote a real original bullet. It is advisory and never
  // authorizes new wording or new skills; the editor still uses verified variants.
  const semantic = requirement.semanticEvidence.flatMap(e => {
    if (!e || typeof e !== 'object') return [];
    const bullet = bullets.find(b => b.id === e.bulletId && typeof e.quote === 'string' && e.quote.length >= 12 && (b.text.includes(e.quote) || b.originalText.includes(e.quote)));
    return bullet && ['equivalent', 'related'].includes(e.match) ? [{ ...bullet, assessment: requirement.category.endsWith('technical_skill') ? 'related' : e.match, rationale: String(e.reason ?? '').slice(0, 300) }] : [];
  });
  const exact = containsTerm(text, requirement.keyword);
  const normalized = terms.some(t => containsTerm(text, t));
  const needsBullet = ['core_responsibility', 'domain_experience'].includes(requirement.category);
  const status = exact && (!needsBullet || direct.length) ? 'exact' : normalized && !needsBullet || semantic.some(e => e.assessment === 'equivalent') ? 'equivalent' : semantic.length || (needsBullet && (exact || equivalent.length)) ? 'related' : 'unsupported';
  return { ...requirement, evidence_basis: direct.length ? 'experience_bullet' : exact ? 'resume_declaration' : normalized ? 'verified_alias' : semantic.length ? 'model_assessment_with_quote' : 'none', semanticEvidence: undefined, status, exact_keyword_present: exact, evidence: [...new Map([...direct, ...equivalent, ...semantic].map(b => [b.id, b])).values()], verified_skill_id: skill?.id ?? null };
}

export function coverageReport(requirements) {
  const covered = r => ['exact', 'equivalent'].includes(r.status);
  return {
    explicitly_matched: requirements.filter(r => r.status === 'exact').map(r => r.keyword),
    semantically_matched: requirements.filter(r => r.status === 'equivalent').map(r => r.keyword),
    missing_requirements: requirements.filter(r => !covered(r)).map(r => r.keyword),
    related_requirements: requirements.filter(r => r.status === 'related').map(r => r.keyword),
    unsupported_not_inserted: requirements.filter(r => ['unsupported', 'related'].includes(r.status) && !r.exact_keyword_present).map(r => r.keyword),
    priority_coverage: Object.fromEntries(['high', 'medium', 'low'].map(p => [p, { covered: requirements.filter(r => r.priority === p && covered(r)).length, total: requirements.filter(r => r.priority === p).length }])),
    note: 'Requirement coverage is an internal relevance analysis, not an ATS score, rejection prediction, or interview probability. Semantic assessments are advisory.'
  };
}

export function analyzeResumeCoverage(jd, raw, profile, resume) {
  const requirements = extractRequirements(jd, raw, profile).map(r => matchRequirement(r, profile, resume));
  return { requirements, report: coverageReport(requirements) };
}

export function analyzeMatches(jd, raw, profile, resumes) {
  const extracted = extractRequirements(jd, raw, profile);
  if (!extracted.length) throw new Error('No source-grounded requirements found in job analysis. Try again.');
  const matches = Object.fromEntries(RESUME_IDS.map(id => [id, extracted.map(r => matchRequirement(r, profile, resumes[id]))]));
  // Compare coverage by priority first; frequency never contributes.
  const vectors = Object.fromEntries(RESUME_IDS.map(id => [id, ['high', 'medium', 'low'].map(p => matches[id].filter(r => r.priority === p && ['exact', 'equivalent'].includes(r.status)).length)]));
  const compare = (a, b) => { for (let i = 0; i < 3; i++) if (vectors[a][i] !== vectors[b][i]) return vectors[b][i] - vectors[a][i]; return 0; };
  const ranked = [...RESUME_IDS].sort(compare);
  const recommended = RESUME_IDS.includes(raw.recommended_resume) && compare(raw.recommended_resume, ranked[0]) === 0 ? raw.recommended_resume : ranked[0];
  const requirements = matches[recommended];
  const report = coverageReport(requirements);
  const current = displayedText(profile, resumes[recommended]);
  const skillsText = displayedSkills(profile, resumes[recommended]);
  const missing = [], missingFromSkills = [], unsupported = [];
  for (const r of requirements) {
    const skill = skillForKeyword(r.keyword, profile);
    if (!skill && ['unsupported', 'related'].includes(r.status)) unsupported.push(r.keyword);
    if (skill && ![skill.label, ...(skill.aliases ?? [])].some(t => containsTerm(current, t))) missing.push(r.keyword);
    if (skill?.categories?.some(c => resumes[recommended].skillGroups.some(g => g.label === c)) && ![skill.label, ...(skill.aliases ?? [])].some(t => containsTerm(skillsText, t))) missingFromSkills.push(r.keyword);
  }
  return { recommended_resume: recommended, job_category: String(raw.job_category ?? 'software_engineering').slice(0, 80), requirements, report, important_keywords: requirements.map(r => r.keyword), matched_keywords: requirements.filter(r => ['exact', 'equivalent'].includes(r.status)).map(r => r.keyword), missing_but_verified: missing, missing_from_skills: missingFromSkills, unsupported_keywords: unsupported, coverage_by_resume: vectors };
}
