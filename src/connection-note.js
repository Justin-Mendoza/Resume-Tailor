import { skillForKeyword, skillTerms, containsTerm, evidenceCatalog } from './matcher.js';

export const CONNECTION_NOTE_LIMIT = 300;
const clean = value => String(value ?? '').replace(/\s+/g, ' ').trim();
function shortLabel(value, limit) {
  const text = clean(value);
  if (text.length <= limit) return text;
  const prefix = text.slice(0, limit - 1);
  const space = prefix.lastIndexOf(' ');
  return (space > limit / 2 ? prefix.slice(0, space) : prefix) + '…';
}

// Compose from demonstrated qualifications, never unsupported requirements or
// pending claims. This deterministic template is the failure fallback.
export function createConnectionNote({ jobTitle, company, requirements, profile }) {
  const priorities = { critical: 5, high: 4, medium: 2, low: 1 };
  const matched = [...requirements].filter(r => r.demonstrated && String(r.category).endsWith('technical_skill'))
    .sort((a, b) => (priorities[b.priority] ?? 0) - (priorities[a.priority] ?? 0));
  const seen = new Set();
  const focus = matched.flatMap(r => {
    const skill = skillForKeyword(r.keyword, profile);
    if (!skill || seen.has(skill.id)) return [];
    seen.add(skill.id);
    const label = clean(r.keyword).length <= 45 ? clean(r.keyword) : skill.label;
    return [label];
  }).slice(0, 2);
  const compose = (role, employer, skills) => `Hi! I just applied for the ${role} role at ${employer}. ${skills.length ? `My experience with ${skills.join(' and ')} aligns with the work you're hiring for. ` : "I'm excited about the opportunity to contribute to your team. "}I'd love to connect!`;
  const title = clean(jobTitle) || 'engineering';
  const employer = clean(company) || 'your company';
  const candidates = [
    compose(title, employer, focus),
    compose(shortLabel(title, 65), shortLabel(employer, 45), focus),
    compose(shortLabel(title, 55), shortLabel(employer, 35), focus.slice(0, 1)),
    compose(shortLabel(title, 55), shortLabel(employer, 35), [])
  ];
  return candidates.find(note => note.length <= CONNECTION_NOTE_LIMIT);
}


// A draft is never shortened by cutting a sentence. Invalid, over-limit, or
// unsupported output falls back to the complete deterministic note.
export async function generateConnectionNote(provider, input) {
  const fallback = createConnectionNote(input);
  const { profile, resume, requirements, jobTitle, company, jobDescription } = input;
  const evidence = evidenceCatalog(profile, resume);
  const sources = evidence.map(({ id, text, skillIds }) => ({ id, text, skillIds }));
  try {
    const result = await provider.connectionNote({ jobTitle, company, jobDescription, requirements: requirements.map(({ keyword, priority, demonstrated }) => ({ keyword, priority, demonstrated })), approvedExperience: sources, maxCharacters: CONNECTION_NOTE_LIMIT });
    if (typeof result?.note !== 'string' || !Array.isArray(result.evidenceIds) || !result.evidenceIds.length || new Set(result.evidenceIds).size !== result.evidenceIds.length) return fallback;
    const note = clean(result.note);
    if (!note || note.length > CONNECTION_NOTE_LIMIT || /[\\<>\u0000-\u001f\u007f-\u009f\u200b-\u200f\u202a-\u202e\u2060-\u206f]/u.test(note)) return fallback;
    const cited = result.evidenceIds.map(id => sources.find(s => s.id === id));
    if (cited.some(s => !s)) return fallback;
    const sourceText = cited.map(s => s.text).join(' ');
    // Role/company numbers are legitimate (e.g. Engineer II, Company 42).
    const context = `${sourceText} ${jobTitle} ${company}`;
    for (const term of ['led', 'managed', 'owned', 'architected', 'production', 'deployed', 'trained']) {
      if (containsTerm(note, term) && !containsTerm(context, term)) return fallback;
    }
    const numbers = value => value.match(/(?:[$~≈]\s*)?\d[\d,]*(?:\.\d+)?(?:\s*(?:%|\+|x|×))?/g) ?? [];
    if (numbers(note).some(n => !numbers(context).includes(n))) return fallback;
    for (const skill of profile.skills) {
      const terms = [skill.label, ...(skill.aliases ?? [])];
      if (terms.some(t => containsTerm(note, t)) && !terms.some(t => containsTerm(context, t)) && !cited.some(s => s.skillIds.includes(skill.id))) return fallback;
    }
    for (const r of requirements) {
      const terms = skillTerms(r.keyword, skillForKeyword(r.keyword, profile));
      if (!r.demonstrated && terms.some(t => containsTerm(note, t)) && !terms.some(t => containsTerm(context, t))) return fallback;
    }
    // Reuse the existing independent factual review for semantic inflation and
    // unfamiliar tools that cannot be detected with a finite technology catalog.
    const audit = await provider.reviewEdits({ contentType: 'linkedin_connection_note', candidates: [{ id: 'connection_note', original: '', proposed: note, sources: cited, jobTitle, company }] });
    const reviews = Array.isArray(audit?.reviews) ? audit.reviews.filter(r => r?.id === 'connection_note') : [];
    const review = reviews[0];
    if (reviews.length !== 1 || review.supported !== true || review.improves !== true || !Array.isArray(review.unsupportedClaims) || review.unsupportedClaims.length) return fallback;
    return note;
  } catch {
    // A note failure must never prevent delivery of the generated PDF.
    return fallback;
  }
}
