import { workExperienceEvidence } from './work-experience.js';
import { splitRequirements, explicitTechnologyQualifications } from './requirement-normalization.js';
import { parseTechnicalRequirement, technicalEvidence } from './technical-requirements.js';
import { competencyEvidence, needsCandidateConfirmation } from './competencies.js';
import { RESUME_IDS } from './data.js';

// Deliberately narrow implications: these name competencies, never new tools,
// production status, leadership, or measured outcomes.
const implications = [
  { keyword: 'Transaction-safe design', pattern: /transactions?.*atomic|atomic.*transactions?/i },
  { keyword: 'Fault-tolerant system design', pattern: /(?:retr(?:y|ies).*(?:failure isolation)|failure isolation.*retr(?:y|ies)|downstream outage buffers)/i },
  { keyword: 'Asynchronous processing', pattern: /(?:queues?.*workers?|producer and consumer|event-driven pipeline)/i },
  { keyword: 'API development', pattern: /(?:implemented|built|developed).*API endpoints/i },
  { keyword: 'Stateful service design', pattern: /persistent state.*deduplication|deduplication.*persistent state/i },
  { keyword: 'Distributed systems concepts', pattern: /cross-service communication|independent producer and consumer services/i },
  { keyword: 'Containerization', pattern: /Docker/i },
  { keyword: 'Observability fundamentals', pattern: /logging and monitoring|monitoring and logging/i }
];

export function inferredCompetencies(text) {
  return implications.filter(rule => rule.pattern.test(text)).map(({ keyword }) => keyword);
}


export function normalize(text) {
  return String(text).normalize('NFKC').toLowerCase().replace(/[^\p{L}\p{N}+#.]+/gu, ' ').trim().replace(/\s+/g, ' ');
}

export function containsTerm(haystack, needle) {
  const h = ` ${normalize(haystack).replace(/\.(?= |$)/g, ' ')} `;
  const n = normalize(needle);
  return !!n && h.includes(` ${n} `);
}

export function skillTerms(keyword, skill) {
  if (!skill) return [keyword];
  // The combined display label declares two distinct languages, not synonyms.
  if (skill.id === 'typescript_js') return ['javascript', 'js'].includes(normalize(keyword)) ? ['JavaScript', 'JS'] : normalize(keyword) === 'typescript' ? ['TypeScript'] : [skill.label];
  return [skill.label, ...(skill.aliases ?? [])];
}

export function skillForKeyword(keyword, profile) {
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
      return resume.rewrites?.[`${section}:${sel.entryId}:${id}`] ?? (variant === undefined ? bullet?.text ?? '' : bullet?.variants?.[variant] ?? '');
    });
  }));
  const education = (resume.education ?? []).flatMap(sel => { const entry = profile.education.find(e => e.id === sel.entryId); return entry ? [entry.school, entry.degree, entry.dates, ...(entry.details ?? [])] : []; });
  return [...skills, ...projectTech, ...headings, ...bullets, ...education].join(' | ');
}

function displayedSkills(profile, resume) {
  return resume.skillGroups.flatMap(group => group.skillIds)
    .map(id => profile.skills.find(skill => skill.id === id)?.label ?? '').join(' | ');
}

const categories = new Set(['required_technical_skill', 'preferred_technical_skill', 'core_responsibility', 'domain_experience', 'engineering_competency', 'other_qualification']);
const priorityValue = { critical: 4, high: 3, medium: 2, low: 1 };

// Only curated aliases authorize terminology changes. Model synonyms remain advisory.
export function extractRequirements(jd, raw, profile) {
  const rows = Array.isArray(raw.requirements) ? raw.requirements : (raw.important_keywords ?? []).map(keyword => ({ keyword, source: keyword, priority: 'medium', category: 'required_technical_skill' }));
  const result = [];
  for (const row of splitRequirements([...rows, ...explicitTechnologyQualifications(jd, rows)])) {
    if (typeof row?.keyword !== 'string' || typeof row.source !== 'string' || !row.keyword.trim() || !row.source.trim() || !jd.includes(row.source)) continue;
    const parsed = parseTechnicalRequirement(row.keyword, profile.skills, { normalize, containsTerm });
    const single = parsed?.groups.length === 1 && !parsed.groups[0].unknown && parsed.groups[0].components.length === 1 ? parsed.groups[0].components[0] : null;
    const canonicalKeyword = single?.term ?? row.keyword;
    const skill = skillForKeyword(canonicalKeyword, profile);
    const sourceTerms = [canonicalKeyword, ...skillTerms(canonicalKeyword, skill)];
    if (['required_technical_skill', 'preferred_technical_skill'].includes(row.category) && !sourceTerms.some(term => containsTerm(row.source, term))) continue;
    const keyword = skill && String(row.category).endsWith('technical_skill') && !containsTerm(row.source, canonicalKeyword) ? sourceTerms.find(term => containsTerm(row.source, term)) : canonicalKeyword;
    const key = skill ? `${skill.id}:${skill.label.includes('/') ? normalize(skillTerms(canonicalKeyword, skill)[0]) : ''}` : normalize(row.keyword);
    const requirement = { keyword: keyword.trim().slice(0, 160), aliases: Array.isArray(row.aliases) ? row.aliases.filter(x => typeof x === 'string').slice(0, 10) : [], category: categories.has(row.category) ? row.category : 'other_qualification', priority: row.category === 'required_technical_skill' ? (row.priority === 'critical' ? 'critical' : 'high') : row.category === 'preferred_technical_skill' ? 'medium' : priorityValue[row.priority] ? row.priority : 'medium', source: row.source, key, semanticEvidence: Array.isArray(row.evidence) ? row.evidence : [] };
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
      items.push({ id: `${section}:${entry.id}:${id}`, text: resume.rewrites?.[`${section}:${entry.id}:${id}`] ?? (variant === undefined ? bullet.text : bullet.variants[variant]), originalText: bullet.text, skillIds: bullet.skillIds ?? [], competencies: inferredCompetencies(bullet.text) });
    }
  }
  return items;
}

// Education is structured evidence, not an experience bullet or a skill keyword.
export function educationCatalog(profile, resume, now = new Date()) {
  const monthNames = { jan: 0, feb: 1, mar: 2, apr: 3, may: 4, jun: 5, jul: 6, aug: 7, sep: 8, oct: 9, nov: 10, dec: 11 };
  return (resume.education ?? []).flatMap(sel => {
    const entry = profile.education.find(e => e.id === sel.entryId);
    if (!entry) return [];
    const end = entry.dates.split(/[–—]|\s-\s/).at(-1).trim();
    const date = end.match(/([A-Za-z]+)\.?\s+(\d{4})/);
    const yearOnly = end.match(/^\d{4}$/);
    const endYear = date ? Number(date[2]) : yearOnly ? Number(end) : null;
    const month = date ? monthNames[date[1].slice(0, 3).toLowerCase()] : 11;
    const future = endYear !== null && (endYear > now.getFullYear() || endYear === now.getFullYear() && month >= now.getMonth());
    const inProgress = entry.completionStatus === 'in_progress' || future || /expected|anticipated|present|current|pursuing|in progress|incomplete|not conferred/i.test(`${entry.degree} ${end}`);
    const completion = inProgress ? 'in_progress' : entry.completionStatus === 'completed' || endYear !== null && month !== undefined ? 'completed' : 'unverified';
    return [{ id: `education:${entry.id}`, text: `${entry.degree} — ${entry.school}; ${entry.dates}`, degree: entry.degree, school: entry.school, dates: entry.dates, completion_status: completion }];
  });
}

function degreeLevels(text) {
  const patterns = [
    ['bachelor', /\b(?:bachelor(?:['’]s|s)?|b\.?\s?sc\.?|b\.?\s?s\.?|b\.?\s?a\.?)\b/i],
    ['master', /\b(?:master(?:['’]s|s)?|m\.?\s?sc\.?|m\.?\s?s\.?|m\.?\s?a\.?)\b/i],
    ['doctorate', /\b(?:ph\.?\s?d\.?|doctorate|doctoral)\b/i]
  ];
  return patterns.filter(([, pattern]) => pattern.test(text)).map(([level]) => level);
}

function educationMatches(requirement, profile, resume) {
  if (requirement.category !== 'other_qualification') return [];
  const requested = requirement.keyword;
  const levels = degreeLevels(requested);
  if (!levels.length || levels.length > 1 && /\band\b/i.test(requested) && !/\bor\b/i.test(requested)) return [];
  const fields = ['computer science', 'software engineering', 'computer engineering', 'electrical engineering', 'mathematics', 'physics', 'chemistry', 'biology', 'business'];
  const requiredFields = fields.filter(field => containsTerm(requested, field));
  if (containsTerm(requested, 'CS') && !requiredFields.includes('computer science')) requiredFields.push('computer science');
  const pursuingAccepted = /pursuing|working toward|enrolled|in progress|current student/i.test(`${requirement.source} ${requested}`);
  return educationCatalog(profile, resume).flatMap(e => {
    if (!degreeLevels(e.degree).some(level => levels.includes(level))) return [];
    const fieldMatch = requiredFields.length ? requiredFields.some(field => containsTerm(e.degree, field)) : !/\bin\b/i.test(requested) || /\bin (?:a )?(?:similar |related )?technical field/i.test(requested);
    if (!fieldMatch) return [];
    const extraConditions = /\bgpa\b|accredited|honou?rs|\d+\+?\s*years?|graduat(?:e|ion|ing) (?:by|before)/i.test(`${requested} ${requirement.source}`);
    const satisfied = !extraConditions && (e.completion_status === 'completed' || pursuingAccepted && e.completion_status === 'in_progress');
    const rationale = e.completion_status === 'in_progress' ? `Degree is in progress (${e.dates}); do not claim a completed degree.` : e.completion_status === 'unverified' ? 'Degree completion has not been verified.' : 'Verified degree level and field match an accepted qualification.';
    return [{ ...e, assessment: satisfied ? 'equivalent' : 'related', rationale: extraConditions ? `${rationale} Additional education conditions need verification.` : rationale }];
  });
}

function matchRequirement(requirement, profile, resume) {
  const skill = skillForKeyword(requirement.keyword, profile);
  const text = displayedText(profile, resume);
  const terms = skillTerms(requirement.keyword, skill);
  const bullets = evidenceCatalog(profile, resume);
  const direct = bullets.filter(b => containsTerm(b.text, requirement.keyword));
  const equivalent = bullets.filter(b => terms.some(t => containsTerm(b.text, t)) || (skill && !skill.label.includes('/') && b.skillIds.includes(skill.id)));
  // Semantic evidence must quote a real original bullet. It is advisory and never
  // authorizes new wording or new skills; free rewrites require separate review.
  const semantic = requirement.semanticEvidence.flatMap(e => {
    if (!e || typeof e !== 'object') return [];
    const bullet = bullets.find(b => b.id === e.bulletId && typeof e.quote === 'string' && e.quote.length >= 12 && (b.text.includes(e.quote) || b.originalText.includes(e.quote)));
    return bullet && ['equivalent', 'related'].includes(e.match) ? [{ ...bullet, assessment: requirement.category.endsWith('technical_skill') ? 'related' : e.match, rationale: String(e.reason ?? '').slice(0, 300) }] : [];
  });
  if (requirement.category === 'engineering_competency') for (const bullet of bullets) {
    if (bullet.competencies.some(c => normalize(c) === normalize(requirement.keyword))) semantic.push({ ...bullet, assessment: 'equivalent', rationale: 'Narrow evidence-backed engineering implication' });
  }
  const technical = skill ? null : technicalEvidence(parseTechnicalRequirement(requirement.keyword, profile.skills, { normalize, containsTerm }), bullets, { skills: profile.skills, containsTerm, skillTerms }, `${requirement.keyword} ${requirement.source}`);
  if (technical) semantic.push(...technical.evidence);
  const competency = skill || technical ? [] : competencyEvidence(requirement, bullets, { skills: profile.skills, containsTerm });
  semantic.push(...competency);
  // Relational database families are not synonyms for transaction guarantees.
  // A verified project stack establishes a declaration, not ACID/locking use.
  if (/^relational databases?$/i.test(requirement.keyword)) {
    for (const selected of resume.projects) {
      const dbs = selected.techSkillIds.filter(id => ['postgresql', 'mysql'].includes(id));
      if (dbs.length) semantic.push({ id: `projects:${selected.entryId}:database_stack`, text: `Verified project stack: ${dbs.map(id => profile.skills.find(s => s.id === id).label).join(', ')}`, assessment: 'related', rationale: 'Relational database technology is listed for this project; specific database operations and transaction-safe design are not established by the stack alone.' });
    }
    for (const b of bullets) if (/\b(?:PostgreSQL|Postgres|MySQL)\b/i.test(b.text)) semantic.push({ ...b, assessment: 'equivalent', rationale: 'Demonstrated use of a relational database.' });
  }
  const work = workExperienceEvidence(requirement, profile, resume);
  if (work) semantic.push(...work.evidence);
  const requiresConfirmation = needsCandidateConfirmation(requirement);
  // A quote proves provenance, not duration or specialized scope. Do not let
  // an optimistic model assessment override a narrower deterministic assessment.
  const qualifierUnverified = (competency.length > 0 && competency.every(e => e.assessment === 'related')) || !!(technical?.evidence.length && !technical.satisfied) || !!(work && !work.satisfied);
  if (qualifierUnverified) for (const e of semantic) e.assessment = 'related';
  const education = educationMatches(requirement, profile, resume);
  const educationSatisfied = education.some(e => e.assessment === 'equivalent');
  const educationRequirement = requirement.category === 'other_qualification' && degreeLevels(requirement.keyword).length > 0;
  const exact = containsTerm(text, requirement.keyword);
  const normalized = terms.some(t => containsTerm(text, t));
  const needsBullet = ['core_responsibility', 'domain_experience', 'engineering_competency', 'other_qualification'].includes(requirement.category);
  const status = requiresConfirmation ? 'unsupported' : educationSatisfied ? 'equivalent' : education.length ? 'related' : educationRequirement ? 'unsupported' : qualifierUnverified ? 'related' : exact && (!needsBullet || direct.length) ? 'exact' : normalized && (!needsBullet || skill && equivalent.length > 0) || semantic.some(e => e.assessment === 'equivalent') ? 'equivalent' : semantic.length || (needsBullet && (exact || equivalent.length)) ? 'related' : 'unsupported';
  return { ...requirement, requires_confirmation: requiresConfirmation, unverified_qualifiers: [...new Set([...competency.flatMap(e => e.unverified_qualifiers ?? []), ...(technical?.duration || work && !work.satisfied ? ['experience_duration'] : [])])], verified_terminology_present: normalized, demonstrated: requiresConfirmation || qualifierUnverified ? false : educationRequirement ? educationSatisfied : direct.length > 0 || equivalent.length > 0 || semantic.some(e => e.assessment === 'equivalent'), match_class: { exact: 'direct_match', equivalent: 'equivalent_match', related: 'related_experience', unsupported: 'missing' }[status], experience_duration: work ? { verified_months: work.verified_months, minimum_months: work.minimum_months } : undefined, evidence_basis: requiresConfirmation ? 'candidate_confirmation' : work?.evidence.length ? 'employment_dates' : education.length ? 'education_record' : direct.length ? 'experience_bullet' : exact ? 'resume_declaration' : normalized ? 'verified_alias' : technical?.evidence.length ? 'verified_technical_components' : competency.length ? 'verified_competency' : semantic.length ? 'model_assessment_with_quote' : 'none', semanticEvidence: undefined, status, exact_keyword_present: exact, evidence: [...new Map([...direct, ...equivalent, ...semantic, ...education].map(b => [b.id, b])).values()], verified_skill_id: skill?.id ?? null };
}

export const REQUIREMENT_WEIGHTS = Object.freeze({ critical: 5, high: 4, medium: 2, low: 1 });

export function coverageReport(requirements) {
  const pendingConfirmation = requirements.filter(r => r.requires_confirmation);
  requirements = requirements.filter(r => !r.requires_confirmation);
  const covered = r => ['exact', 'equivalent'].includes(r.status);
  const demonstrated = r => r.demonstrated ?? (covered(r) && (r.evidence ?? []).length > 0);
  const totalWeight = requirements.reduce((sum, r) => sum + (REQUIREMENT_WEIGHTS[r.priority] ?? 2), 0);
  const demonstratedWeight = requirements.filter(demonstrated).reduce((sum, r) => sum + (REQUIREMENT_WEIGHTS[r.priority] ?? 2), 0);
  return {
    candidate_confirmations: pendingConfirmation.map(r => ({ keyword: r.keyword, source: r.source, reason: 'Confirm this preference or eligibility directly; it is not inferred from resume experience and is excluded from coverage.' })),
    weighted_coverage: { weights: REQUIREMENT_WEIGHTS, demonstrated_weight: demonstratedWeight, total_weight: totalWeight, percent: totalWeight ? Math.round(1000 * demonstratedWeight / totalWeight) / 10 : null, diagnostic_only: true, basis: 'Demonstrated experience/project or qualifying education evidence; skills-only declarations and related-only assessments do not earn credit. No ATS score or optimization target.' },
    critical_demonstrated: requirements.filter(r => r.priority === 'critical' && demonstrated(r)).map(r => r.keyword),
    critical_not_demonstrated: requirements.filter(r => r.priority === 'critical' && !demonstrated(r)).map(r => r.keyword),
    unsupported_requirements: requirements.filter(r => !demonstrated(r) && !covered(r) && !r.verified_skill_id && r.evidence_basis !== 'education_record').map(r => r.keyword),
    exact_keywords_present: requirements.filter(r => r.exact_keyword_present).map(r => r.keyword),
    equivalent_keywords_present: requirements.filter(r => !r.exact_keyword_present && r.status === 'equivalent').map(r => r.keyword),
    presentation_gaps: requirements.flatMap(r => [
      ...(r.evidence_basis !== 'education_record' && !r.exact_keyword_present && (covered(r) || demonstrated(r)) ? [{ keyword: r.keyword, kind: 'exact_wording', suggestion: 'Prefer the JD wording where it accurately names the verified qualification.' }] : []),
      ...(r.evidence_basis === 'education_record' && !demonstrated(r) ? [{ keyword: r.keyword, kind: 'education_completion', suggestion: r.evidence.find(e => e.completion_status)?.rationale ?? 'Verify the remaining education conditions.' }] : []),
      ...(r.verified_skill_id && r.verified_terminology_present === false ? [{ keyword: r.keyword, kind: 'verified_not_present', suggestion: 'Surface this verified skill where relevant; a project-specific use still requires evidence.' }] : []),
      ...(covered(r) && !demonstrated(r) ? [{ keyword: r.keyword, kind: 'declaration_only', suggestion: 'Listed qualification lacks a demonstrated bullet; add evidence only if verified.' }] : [])
    ]),
    explicitly_matched: requirements.filter(r => r.status === 'exact').map(r => r.keyword),
    semantically_matched: requirements.filter(r => r.status === 'equivalent').map(r => r.keyword),
    missing_requirements: requirements.filter(r => !covered(r)).map(r => r.keyword),
    related_requirements: requirements.filter(r => r.status === 'related').map(r => r.keyword),
    unsupported_not_inserted: requirements.filter(r => ['unsupported', 'related'].includes(r.status) && !r.exact_keyword_present).map(r => r.keyword),
    priority_coverage: Object.fromEntries(['critical', 'high', 'medium', 'low'].map(p => [p, { covered: requirements.filter(r => r.priority === p && covered(r)).length, total: requirements.filter(r => r.priority === p).length }])),
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
  const vectors = Object.fromEntries(RESUME_IDS.map(id => [id, ['critical', 'high', 'medium', 'low'].map(p => matches[id].filter(r => r.priority === p && ['exact', 'equivalent'].includes(r.status)).length)]));
  const compare = (a, b) => { for (let i = 0; i < 4; i++) if (vectors[a][i] !== vectors[b][i]) return vectors[b][i] - vectors[a][i]; return 0; };
  const ranked = [...RESUME_IDS].sort(compare);
  const recommended = RESUME_IDS.includes(raw.recommended_resume) && compare(raw.recommended_resume, ranked[0]) === 0 ? raw.recommended_resume : ranked[0];
  const requirements = matches[recommended];
  const report = coverageReport(requirements);
  const current = displayedText(profile, resumes[recommended]);
  const skillsText = displayedSkills(profile, resumes[recommended]);
  const missing = [], missingFromSkills = [], unsupported = [];
  for (const r of requirements) {
    const skill = skillForKeyword(r.keyword, profile);
    if (!skill && !r.requires_confirmation && ['unsupported', 'related'].includes(r.status)) unsupported.push(r.keyword);
    if (skill && ![skill.label, ...(skill.aliases ?? [])].some(t => containsTerm(current, t))) missing.push(r.keyword);
    if (skill?.categories?.some(c => resumes[recommended].skillGroups.some(g => g.label === c)) && ![skill.label, ...(skill.aliases ?? [])].some(t => containsTerm(skillsText, t))) missingFromSkills.push(r.keyword);
  }
  return { recommended_resume: recommended, job_category: String(raw.job_category ?? 'software_engineering').slice(0, 80), requirements, report, important_keywords: requirements.map(r => r.keyword), matched_keywords: requirements.filter(r => ['exact', 'equivalent'].includes(r.status)).map(r => r.keyword), missing_but_verified: missing, missing_from_skills: missingFromSkills, unsupported_keywords: unsupported, coverage_by_resume: vectors };
}
