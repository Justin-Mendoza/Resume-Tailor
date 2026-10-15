import { containsTerm } from './matcher.js';

export { inferredCompetencies } from './matcher.js';

export function rewriteSources(profile, section, entryId, ids) {
  const entry = profile[section]?.find(e => e.id === entryId);
  if (!entry || !Array.isArray(ids) || !ids.length || new Set(ids).size !== ids.length) return null;
  const bullets = ids.map(id => entry.bullets.find(b => b.id === id));
  if (bullets.some(b => !b)) return null;
  return bullets.map(b => ({ id: b.id, text: b.text, variants: b.variants ?? [], skillIds: b.skillIds ?? [] }));
}

const numbers = text => text.match(/(?:[$~≈]\s*)?\d[\d,]*(?:\.\d+)?(?:\s*(?:%|\+|x|×))?/g) ?? [];
const subset = (small, large) => { const copy = [...large]; return small.every(x => { const i = copy.indexOf(x); if (i < 0) return false; copy.splice(i, 1); return true; }); };

// Necessary deterministic checks; passing these alone NEVER approves free text.
export function checkRewrite(original, proposed, sources, profile, analysis) {
  if (typeof proposed !== 'string' || !proposed.trim() || proposed !== proposed.trim() || proposed === original || /[\n\r\\<>\u0000-\u001f\u007f-\u009f\u200b-\u200f\u202a-\u202e\u2060-\u206f]/u.test(proposed)) return false;
  if (proposed.length > Math.max(original.length, 360) || proposed.split(/\s+/).length > 65) return false;
  const sourceText = sources.flatMap(s => [s.text, ...s.variants]).join(' ');
  // Retain original measurements; any extra measurements must occur in evidence.
  // The semantic review checks what each measurement describes and its qualifiers.
  if (!subset(numbers(original), numbers(proposed)) || !subset(numbers(proposed), numbers(sourceText))) return false;
  for (const skill of profile.skills) {
    if (skill.id === 'typescript_js') {
      for (const terms of [['TypeScript'], ['JavaScript', 'JS']]) {
        if (terms.some(t => containsTerm(proposed, t)) && !terms.some(t => containsTerm(sourceText, t))) return false;
        if (terms.some(t => containsTerm(original, t)) && !terms.some(t => containsTerm(proposed, t))) return false;
      }
      continue;
    }
    const terms = [skill.label, ...(skill.aliases ?? [])];
    if (terms.some(t => containsTerm(proposed, t)) && !terms.some(t => containsTerm(sourceText, t)) && !sources.some(s => s.skillIds.includes(skill.id))) return false;
    if (terms.some(t => containsTerm(original, t)) && !terms.some(t => containsTerm(proposed, t))) return false;
  }
  for (const r of analysis.requirements ?? []) {
    if (r.category.endsWith('technical_skill') && !r.verified_skill_id && containsTerm(proposed, r.keyword) && !containsTerm(sourceText, r.keyword)) return false;
  }
  for (const term of ['led', 'managed', 'owned', 'architected', 'production', 'deployed']) {
    if (containsTerm(proposed, term) && !containsTerm(sourceText, term)) return false;
  }
  return true;
}

// Reviews are server-owned records bound to the exact candidate, never a model-
// supplied "verified" flag or a browser approval of an unsupported claim.
export function reviewKey(raw) {
  return JSON.stringify([raw.section, raw.targetId, raw.itemId, raw.sourceBulletIds, raw.proposed]);
}

export async function reviewRewrites(provider, candidates, analysis, profile, resume) {
  const pending = [];
  for (const raw of Array.isArray(candidates) ? candidates : []) {
    if (raw?.operation !== 'bullet_rewrite' || !['experience', 'projects'].includes(raw.section)) continue;
    const selection = resume[raw.section].find(e => e.entryId === raw.targetId);
    const sources = rewriteSources(profile, raw.section, raw.targetId, raw.sourceBulletIds);
    const bullet = profile[raw.section].find(e => e.id === raw.targetId)?.bullets.find(b => b.id === raw.itemId);
    const key = `${raw.section}:${raw.targetId}:${raw.itemId}`;
    const original = resume.rewrites?.[key] ?? (resume.variants?.[key] === undefined ? bullet?.text : bullet?.variants?.[resume.variants[key]]);
    if (!selection?.bulletIds.includes(raw.itemId) || !sources || !raw.sourceBulletIds.includes(raw.itemId) || !checkRewrite(original, raw.proposed, sources, profile, analysis)) continue;
    pending.push({ id: `rewrite_${pending.length + 1}`, key: reviewKey(raw), requirement: analysis.requirements?.find(r => r.keyword === raw.jdKeyword), original, proposed: raw.proposed, sources, verifiedSkills: profile.skills.filter(s => sources.some(b => b.skillIds.includes(s.id))).map(s => s.label) });
  }
  const reviews = new Map();
  if (!pending.length) return { reviews, confirmations: [] };
  const result = await provider.reviewEdits({ candidates: pending.map(({ key, ...candidate }) => candidate) });
  const confirmations = [];
  for (const candidate of pending) {
    const rows = (Array.isArray(result?.reviews) ? result.reviews : []).filter(r => r?.id === candidate.id);
    if (rows.length !== 1) continue;
    const r = rows[0];
    if (r.supported === true && r.improves === true && Array.isArray(r.unsupportedClaims) && r.unsupportedClaims.length === 0 && typeof r.reason === 'string' && r.reason.trim()) reviews.set(candidate.key, { ...candidate, reason: r.reason });
    else if (Array.isArray(r.unsupportedClaims)) for (const claim of r.unsupportedClaims) {
      if (typeof claim === 'string' && claim.trim()) confirmations.push({ original: candidate.original, claim: claim.slice(0, 500), note: 'Requires factual confirmation and an update to the verified profile before use.' });
    }
  }
  return { reviews, confirmations };
}
