import { containsTerm } from './matcher.js';
import { selectedBulletText } from './entry-quality.js';
const weights = { critical: 5, high: 4, medium: 2, low: 1 };
const priorities = ['critical', 'high', 'medium', 'low'];
const eligible = r => !r.requires_confirmation && !['employment_dates', 'education_record'].includes(r.evidence_basis);
function namesSkill(r, skill) {
  return r.verified_skill_id === skill.id || [skill.label, ...(skill.aliases ?? [])].some(t => containsTerm(r.keyword, t) || containsTerm(r.source ?? '', t)) || /^relational databases?$/i.test(r.keyword) && ['postgresql', 'mysql'].includes(skill.id);
}
export function skillRelevance(id, analysis, profile) {
  const skill = profile.skills.find(s => s.id === id);
  return skill ? Math.max(0, ...(analysis.requirements ?? []).filter(eligible).filter(r => namesSkill(r, skill)).map(r => weights[r.priority] ?? 1)) : 0;
}
// Compare requirement priorities lexicographically: many generic supporting
// matches cannot bury demonstrated critical qualifications. Repetition earns
// nothing; each deduplicated requirement contributes at most once per item.
export function compareRelevance(a, b) {
  for (let i = 0; i < Math.max(a.length, b.length); i++) if ((a[i] ?? 0) !== (b[i] ?? 0)) return (a[i] ?? 0) - (b[i] ?? 0);
  return 0;
}
function rankMatches(analysis, match) {
  const rows = (analysis.requirements ?? []).filter(eligible);
  return priorities.flatMap(priority => {
    const matches = rows.filter(r => r.priority === priority).map(match);
    return [matches.filter(m => m === 2).length, matches.filter(m => m === 1).length];
  });
}
export const rankedOrder = (ids, rank) => [...ids].sort((a, b) => compareRelevance(rank(b), rank(a)));
export function improvesOrder(before, after, rank) {
  return after.every((id, i) => i === 0 || compareRelevance(rank(after[i - 1]), rank(id)) >= 0) && after.some((id, i) => compareRelevance(rank(id), rank(before[i])) !== 0);
}
function bulletMatch(section, selection, id, r, profile, resume) {
  const bullet = profile[section].find(e => e.id === selection.entryId).bullets.find(b => b.id === id);
  const evidence = (r.evidence ?? []).filter(e => e.id === `${section}:${selection.entryId}:${id}`);
  const fullySupported = r.demonstrated !== false && !['related', 'unsupported'].includes(r.status);
  if (evidence.some(e => e.assessment !== 'related')) return fullySupported ? 2 : 1;
  const text = selectedBulletText(profile, resume, section, selection.entryId, id);
  const named = containsTerm(text, r.keyword) || (bullet.skillIds ?? []).some(skillId => {
    const skill = profile.skills.find(s => s.id === skillId);
    return skill && namesSkill(r, skill);
  });
  return named ? fullySupported ? 2 : 1 : evidence.length ? 1 : 0;
}
export function bulletRelevance(section, selection, id, analysis, profile, resume) {
  return rankMatches(analysis, r => bulletMatch(section, selection, id, r, profile, resume));
}
export function projectRelevance(selection, analysis, profile, resume) {
  return rankMatches(analysis, r => {
    const demonstrated = Math.max(0, ...selection.bulletIds.map(id => bulletMatch('projects', selection, id, r, profile, resume)));
    if (demonstrated) return demonstrated;
    return selection.techSkillIds.some(id => namesSkill(r, profile.skills.find(s => s.id === id))) ? 1 : 0;
  });
}
export function skillRank(id, analysis, profile) {
  const skill = profile.skills.find(s => s.id === id);
  return rankMatches(analysis, r => {
    if (!namesSkill(r, skill)) return 0;
    const demonstrated = r.demonstrated !== false && !['related', 'unsupported'].includes(r.status) && (r.evidence ?? []).some(e => e.assessment !== 'related' && (e.skillIds?.includes(id) || [skill.label, ...(skill.aliases ?? [])].some(t => containsTerm(e.text ?? '', t))));
    return demonstrated ? 2 : 1;
  });
}
export function skillGroupRelevance(group, analysis, profile) {
  // Keep conventional language and spoken-language anchors; prioritize the
  // technical categories between them using their strongest supported skill.
  const anchor = group.label === 'Languages' ? 1 : group.label === 'Spoken' ? -1 : 0;
  const best = group.skillIds.map(id => skillRank(id, analysis, profile)).sort((a, b) => compareRelevance(b, a))[0] ?? [];
  return [anchor, ...best];
}
