import { containsTerm, normalize } from './matcher.js';

const sameSet = (a, b) => a.length === b.length && new Set(a).size === a.length && new Set(b).size === b.length && a.every(x => b.includes(x));
const clone = value => structuredClone(value);

function findSelection(resume, section, id) {
  return resume[section]?.find(x => x.entryId === id);
}

function findBullet(profile, section, entryId, bulletId) {
  return profile[section]?.find(x => x.id === entryId)?.bullets?.find(x => x.id === bulletId);
}

function bulletText(profile, section, entryId, bulletId, variantIndex = -1) {
  const bullet = findBullet(profile, section, entryId, bulletId);
  return variantIndex < 0 ? bullet?.text : bullet?.variants?.[variantIndex];
}

export function buildChange(raw, analysis, profile, resume) {
  if (!raw || typeof raw !== 'object') return null;
  const keyword = analysis.important_keywords.find(x => normalize(x) === normalize(raw.jdKeyword));
  if (!keyword || analysis.unsupported_keywords.some(x => normalize(x) === normalize(keyword))) return null;
  const reason = String(raw.reason ?? '').trim().slice(0, 240);
  if (!reason) return null;
  const confidence = Number(raw.confidence);
  if (!Number.isFinite(confidence) || confidence < 0 || confidence > 1) return null;
  const base = { operation: raw.operation, section: raw.section, targetId: raw.targetId, itemId: raw.itemId, order: raw.order, variantIndex: raw.variantIndex };
  let original, proposed, title, conflictKey;
  if (raw.operation === 'skill_add' && raw.section === 'skills') {
    const group = resume.skillGroups.find(x => x.label === raw.targetId);
    const skill = profile.skills.find(x => x.id === raw.itemId);
    if (!group || !skill || group.skillIds.includes(skill.id) || !skill.categories.includes(group.label) || !analysis.missing_but_verified.some(x => normalize(x) === normalize(keyword))) return null;
    if (![skill.label, ...(skill.aliases ?? [])].some(x => normalize(x) === normalize(keyword))) return null;
    original = group.skillIds.map(id => profile.skills.find(x => x.id === id).label).join(', ');
    proposed = [...group.skillIds, skill.id].map(id => profile.skills.find(x => x.id === id).label).join(', ');
    title = `Add verified skill · ${group.label}`;
    conflictKey = `group:${group.label}`;
  } else if (raw.operation === 'skill_reorder' && raw.section === 'skills') {
    const group = resume.skillGroups.find(x => x.label === raw.targetId);
    if (!group || !Array.isArray(raw.order) || !sameSet(group.skillIds, raw.order) || group.skillIds.every((x, i) => x === raw.order[i])) return null;
    const relevantIds = group.skillIds.filter(id => {
      const skill = profile.skills.find(x => x.id === id);
      return [skill.label, ...(skill.aliases ?? [])].some(x => normalize(x) === normalize(keyword));
    });
    if (!relevantIds.some(id => raw.order.indexOf(id) < group.skillIds.indexOf(id))) return null;
    original = group.skillIds.map(id => profile.skills.find(x => x.id === id).label).join(', ');
    proposed = raw.order.map(id => profile.skills.find(x => x.id === id).label).join(', ');
    title = `Reorder skills · ${group.label}`;
    conflictKey = `group:${group.label}`;
  } else if (raw.operation === 'project_tech_reorder' && raw.section === 'projects') {
    const sel = findSelection(resume, 'projects', raw.targetId);
    if (!sel || !Array.isArray(raw.order) || !sameSet(sel.techSkillIds, raw.order) || sel.techSkillIds.every((x, i) => x === raw.order[i])) return null;
    const relevantIds = sel.techSkillIds.filter(id => {
      const skill = profile.skills.find(x => x.id === id);
      return [skill.label, ...(skill.aliases ?? [])].some(x => normalize(x) === normalize(keyword));
    });
    if (!relevantIds.some(id => raw.order.indexOf(id) < sel.techSkillIds.indexOf(id))) return null;
    original = sel.techSkillIds.map(id => profile.skills.find(x => x.id === id).label).join(', ');
    proposed = raw.order.map(id => profile.skills.find(x => x.id === id).label).join(', ');
    title = `Reorder project technologies · ${raw.targetId}`;
    conflictKey = `tech:${raw.targetId}`;
  } else if (raw.operation === 'bullet_reorder' && ['experience', 'projects'].includes(raw.section)) {
    const sel = findSelection(resume, raw.section, raw.targetId);
    if (!sel || !Array.isArray(raw.order) || !sameSet(sel.bulletIds, raw.order) || sel.bulletIds.every((x, i) => x === raw.order[i])) return null;
    const relevantIds = sel.bulletIds.filter(id => {
      const b = findBullet(profile, raw.section, raw.targetId, id);
      return containsTerm(b.text, keyword) || (b.skillIds ?? []).some(skillId => {
        const s = profile.skills.find(x => x.id === skillId);
        return s && [s.label, ...(s.aliases ?? [])].some(x => normalize(x) === normalize(keyword));
      });
    });
    if (!relevantIds.some(id => raw.order.indexOf(id) < sel.bulletIds.indexOf(id))) return null;
    original = sel.bulletIds.map(id => `• ${bulletText(profile, raw.section, raw.targetId, id)}`).join('\n');
    proposed = raw.order.map(id => `• ${bulletText(profile, raw.section, raw.targetId, id)}`).join('\n');
    title = `Reorder bullets · ${raw.targetId}`;
    conflictKey = `entry:${raw.section}:${raw.targetId}`;
  } else if (raw.operation === 'bullet_variant' && ['experience', 'projects'].includes(raw.section)) {
    const sel = findSelection(resume, raw.section, raw.targetId);
    const bullet = findBullet(profile, raw.section, raw.targetId, raw.itemId);
    if (!sel?.bulletIds.includes(raw.itemId) || !bullet || !Number.isInteger(raw.variantIndex) || !bullet.variants?.[raw.variantIndex]) return null;
    if (!containsTerm(bullet.variants[raw.variantIndex], keyword)) return null;
    const currentVariant = resume.variants?.[`${raw.section}:${raw.targetId}:${raw.itemId}`];
    original = currentVariant === undefined ? bullet.text : bullet.variants[currentVariant];
    proposed = bullet.variants[raw.variantIndex];
    if (original === proposed || containsTerm(original, keyword)) return null;
    title = `Use verified wording · ${raw.targetId}`;
    conflictKey = `entry:${raw.section}:${raw.targetId}`;
  } else return null;
  return { id: '', title, original, proposed, reason, jdKeyword: keyword, confidence, conflictKey, edit: base };
}

export function validateSuggestions(rawSuggestions, analysis, profile, resume) {
  const changes = [], conflicts = new Set();
  for (const raw of (Array.isArray(rawSuggestions) ? rawSuggestions : []).slice(0, 20)) {
    const change = buildChange(raw, analysis, profile, resume);
    if (!change || conflicts.has(change.conflictKey)) continue;
    conflicts.add(change.conflictKey);
    change.id = `change_${changes.length + 1}`;
    changes.push(change);
    if (changes.length === 5) break;
  }
  return changes;
}

export function fallbackSuggestions(analysis, profile, resume) {
  const candidates = [];
  for (const keyword of analysis.missing_but_verified) {
    const skill = profile.skills.find(s => [s.label, ...(s.aliases ?? [])].some(x => normalize(x) === normalize(keyword)));
    const group = resume.skillGroups.find(g => skill?.categories.includes(g.label));
    if (!skill || !group) continue;
    candidates.push({ operation: 'skill_add', section: 'skills', targetId: group.label, itemId: skill.id, order: [], variantIndex: 0, reason: `The job description emphasizes ${keyword}; this skill is in your verified profile.`, jdKeyword: keyword, confidence: 0.9 });
  }
  if (!candidates.length) {
    for (const keyword of analysis.matched_keywords) {
      const skill = profile.skills.find(s => [s.label, ...(s.aliases ?? [])].some(x => normalize(x) === normalize(keyword)));
      const group = resume.skillGroups.find(g => g.skillIds.includes(skill?.id) && g.skillIds[0] !== skill.id);
      if (!group) continue;
      candidates.push({ operation: 'skill_reorder', section: 'skills', targetId: group.label, itemId: '', order: [skill.id, ...group.skillIds.filter(id => id !== skill.id)], variantIndex: 0, reason: `Put ${keyword} first in its existing skill group because this posting emphasizes it.`, jdKeyword: keyword, confidence: 0.75 });
      break;
    }
  }
  return validateSuggestions(candidates, analysis, profile, resume);
}

export function applyApproved(resume, changes, approvedIds) {
  const result = clone(resume);
  const known = new Set(changes.map(x => x.id));
  if (!Array.isArray(approvedIds) || approvedIds.some(id => !known.has(id)) || new Set(approvedIds).size !== approvedIds.length) throw new Error('Invalid approved change IDs');
  for (const change of changes.filter(x => approvedIds.includes(x.id))) {
    const e = change.edit;
    if (e.operation === 'skill_add') result.skillGroups.find(x => x.label === e.targetId).skillIds.push(e.itemId);
    else if (e.operation === 'skill_reorder') result.skillGroups.find(x => x.label === e.targetId).skillIds = [...e.order];
    else if (e.operation === 'project_tech_reorder') findSelection(result, 'projects', e.targetId).techSkillIds = [...e.order];
    else if (e.operation === 'bullet_reorder') findSelection(result, e.section, e.targetId).bulletIds = [...e.order];
    else if (e.operation === 'bullet_variant') {
      result.variants ??= {};
      result.variants[`${e.section}:${e.targetId}:${e.itemId}`] = e.variantIndex;
    }
  }
  return result;
}
