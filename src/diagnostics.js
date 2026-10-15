import { containsTerm, normalize, skillForKeyword, skillTerms, evidenceCatalog, displayedText } from './matcher.js';

function occurrences(text, term) {
  const words = normalize(text).replace(/\.(?= |$)/g, ' ').split(/\s+/);
  const target = normalize(term).split(/\s+/);
  let count = 0;
  for (let i = 0; i <= words.length - target.length; i++) if (target.every((word, j) => words[i + j] === word)) count++;
  return count;
}

// Local repetition is a review signal, never a resume-wide keyword quota or
// penalty. Skills + project stack + multiple substantive examples are legitimate.
export function keywordSaturation(requirements, profile, resume) {
  const warnings = [];
  const units = [
    ...evidenceCatalog(profile, resume),
    ...resume.skillGroups.map(g => ({ id: `skills:${g.label}`, text: g.skillIds.map(id => profile.skills.find(s => s.id === id).label).join(', ') }))
  ];
  for (const unit of units) {
    for (const r of requirements) {
      const terms = [...new Set(skillTerms(r.keyword, skillForKeyword(r.keyword, profile)))];
      const count = terms.reduce((sum, term) => sum + occurrences(unit.text, term), 0);
      // At least three mentions inside a single bullet/group, rather than three
      // across the resume. Aliases are grouped so alternating spellings count.
      if (count >= 3) warnings.push({ keyword: r.keyword, location: unit.id, occurrences: count, reason: 'Repeated within one bullet or skill group; review for unnatural wording.' });
    }
  }
  return { warnings, diagnostic_only: true, note: 'Heuristic review hints only. No coverage penalty, keyword density target, or limit on distinct technologies. Skills and experience may repeat the same technology.' };
}

const roleTerms = [
  { title: /\b(?:software engineer|software developer|swe)\b/, terms: ['Software Engineer', 'Software Developer', 'SWE'] },
  { title: /\b(?:backend|back end|server side)\b/, terms: ['backend', 'back end', 'server side'] },
  { title: /\b(?:frontend|front end)\b/, terms: ['frontend', 'front end'] },
  { title: /\b(?:fullstack|full stack)\b/, terms: ['fullstack', 'full stack'] },
  { title: /\binfrastructure\b/, terms: ['infrastructure'] },
  { title: /\bplatform\b/, terms: ['platform'] },
  { title: /\b(?:ai|artificial intelligence)\b/, terms: ['AI', 'Artificial Intelligence'] },
  { title: /\b(?:ml|machine learning)\b/, terms: ['ML', 'Machine Learning'] },
  { title: /\bsearch\b/, terms: ['search'] }
];

export function jobTitleAlignment(jobTitle, profile, resume) {
  const target = String(jobTitle ?? '').trim();
  const text = displayedText(profile, resume);
  const terminology = roleTerms.filter(r => r.title.test(normalize(target))).map(r => ({ term: r.terms[0], present: r.terms.some(term => containsTerm(text, term)) }));
  return { target_title: target, exact_title_present: !!target && containsTerm(text, target), terminology, remaining_gaps: terminology.filter(r => !r.present).map(r => r.term), note: 'Target-role terminology is advisory. Missing target title or seniority is not a qualification gap. Preserve all previous official titles; align relevant bullet terminology only when supported.' };
}

export function resumeDiagnostics(requirements, profile, resume, jobTitle) {
  return { keyword_saturation: keywordSaturation(requirements, profile, resume), job_title_alignment: jobTitleAlignment(jobTitle, profile, resume) };
}

// Visibility of verified, named JD technologies is separate from demonstrated
// requirement coverage. A skills declaration can be searchable without proving
// hands-on use or satisfying a bundled qualification.
export function technicalKeywordVisibility(requirements, profile, resume) {
  const text = displayedText(profile, resume);
  const keywords = profile.skills.filter(s => !s.categories.includes('Spoken')).flatMap(skill => {
    const terms = [skill.label, ...(skill.aliases ?? [])];
    const requested = terms.filter(term => requirements.some(r => !r.requires_confirmation && (containsTerm(r.keyword, term) || containsTerm(r.source ?? '', term))));
    if (!requested.length) return [];
    const matches = requested.map(term => skillTerms(term, skill).find(alias => containsTerm(text, alias)));
    const present = matches.every(Boolean);
    return [{ keyword: requested.length === 1 ? requested[0] : skill.label, jd_terms: requested, present, matched_term: present ? [...new Set(matches)].join(', ') : null }];
  });
  return { present: keywords.filter(k => k.present).length, total: keywords.length, keywords, diagnostic_only: true };
}
