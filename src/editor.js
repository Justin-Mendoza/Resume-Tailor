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

function projectMatches(profile, selection, keyword) {
  const project = profile.projects.find(entry => entry.id === selection.entryId);
  const technologies = selection.techSkillIds.map(id => profile.skills.find(skill => skill.id === id)).filter(Boolean);
  const bullets = selection.bulletIds.map(id => project.bullets.find(bullet => bullet.id === id)).filter(Boolean);
  return technologies.some(skill => [skill.label, ...(skill.aliases ?? [])].some(term => normalize(term) === normalize(keyword))) ||
    bullets.some(bullet => containsTerm(bullet.text, keyword) || (bullet.skillIds ?? []).some(id => {
      const skill = profile.skills.find(item => item.id === id);
      return skill && [skill.label, ...(skill.aliases ?? [])].some(term => normalize(term) === normalize(keyword));
    }));
}

function projectName(profile, selection) {
  const entry = profile.projects.find(project => project.id === selection.entryId);
  return entry.nameVariants[selection.nameVariant];
}

export function buildChange(raw, analysis, profile, resume) {
  if (!raw || typeof raw !== 'object') return null;
  const titleEdit = raw.operation === 'experience_title_variant';
  const keyword = titleEdit ? analysis.target_role : analysis.important_keywords.find(x => normalize(x) === normalize(raw.jdKeyword));
  if (!keyword || normalize(raw.jdKeyword) !== normalize(keyword) || (!titleEdit && analysis.unsupported_keywords.some(x => normalize(x) === normalize(keyword)))) return null;
  const reason = String(raw.reason ?? '').trim().slice(0, 240);
  if (!reason) return null;
  const confidence = Number(raw.confidence);
  if (!Number.isFinite(confidence) || confidence < 0 || confidence > 1) return null;
  const base = { operation: raw.operation, section: raw.section, targetId: raw.targetId, itemId: raw.itemId, order: raw.order, variantIndex: raw.variantIndex };
  let original, proposed, title, conflictKey;
  if (titleEdit && raw.section === 'experience') {
    const selected = findSelection(resume, 'experience', raw.targetId);
    const entry = profile.experience.find(item => item.id === raw.targetId);
    if (!selected || !entry || !Number.isInteger(raw.variantIndex) || !entry.titleVariants[raw.variantIndex]) return null;
    original = entry.titleVariants[selected.titleVariant];
    proposed = entry.titleVariants[raw.variantIndex];
    if (original === proposed || containsTerm(original, keyword) || !containsTerm(proposed, keyword) || !/\bIntern\b/.test(proposed)) return null;
    title = `Match verified intern role · ${entry.company}`;
    conflictKey = `title:${entry.id}`;
  } else if (raw.operation === 'skill_add' && raw.section === 'skills') {
    const group = resume.skillGroups.find(x => x.label === raw.targetId);
    const skill = profile.skills.find(x => x.id === raw.itemId);
    if (!group || !skill || group.skillIds.includes(skill.id) || !skill.categories.includes(group.label) || !analysis.missing_from_skills?.some(x => normalize(x) === normalize(keyword))) return null;
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
  } else if (raw.operation === 'project_reorder' && raw.section === 'projects') {
    const projects = resume.projects;
    if (raw.targetId !== 'projects' || !Array.isArray(raw.order) || !sameSet(projects.map(project => project.entryId), raw.order) || projects.every((project, index) => project.entryId === raw.order[index])) return null;
    const oldRelevantIndex = projects.findIndex(project => projectMatches(profile, project, keyword));
    const newRelevantIndex = raw.order.findIndex(id => projectMatches(profile, projects.find(project => project.entryId === id), keyword));
    if (oldRelevantIndex < 0 || newRelevantIndex < 0 || newRelevantIndex >= oldRelevantIndex) return null;
    original = projects.map(project => projectName(profile, project)).join('\n');
    proposed = raw.order.map(id => projectName(profile, projects.find(project => project.entryId === id))).join('\n');
    title = 'Reorder projects';
    conflictKey = 'project-order';
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

// Preserve substantive, validated local edits when Qwen returns only cosmetic
// reorders. Both inputs must already have passed buildChange/validateSuggestions.
export function combineSuggestions(qwenChanges, existingChanges) {
  const rank = change => ({ experience_title_variant: 0, skill_add: 1, bullet_variant: 2, project_reorder: 3, bullet_reorder: 4, project_tech_reorder: 5, skill_reorder: 6 })[change.edit.operation] ?? 7;
  const ordered = [...qwenChanges.map(change => ({ change, source: 0 })), ...existingChanges.map(change => ({ change, source: 1 }))]
    .sort((a, b) => rank(a.change) - rank(b.change) || a.source - b.source);
  const seen = new Set();
  const combined = [];
  for (const { change } of ordered) {
    if (seen.has(change.conflictKey)) continue;
    seen.add(change.conflictKey);
    combined.push({ ...change, id: `change_${combined.length + 1}` });
    if (combined.length === 5) break;
  }
  return combined;
}

export function fallbackSuggestions(analysis, profile, resume) {
  const candidates = [];
  const skillFor = keyword => profile.skills.find(s => [s.label, ...(s.aliases ?? [])].some(x => normalize(x) === normalize(keyword)));
  if (analysis.target_role) {
    for (const selected of resume.experience) {
      const entry = profile.experience.find(item => item.id === selected.entryId);
      const variantIndex = entry.titleVariants.findIndex(title => containsTerm(title, analysis.target_role) && /\bIntern\b/.test(title));
      if (variantIndex < 0 || variantIndex === selected.titleVariant) continue;
      candidates.push({ operation: 'experience_title_variant', section: 'experience', targetId: entry.id, itemId: '', order: [], variantIndex, reason: `Use the existing verified intern title aligned with the ${analysis.target_role} posting.`, jdKeyword: analysis.target_role, confidence: 0.9 });
    }
  }
  for (const keyword of analysis.missing_from_skills ?? analysis.missing_but_verified) {
    const skill = skillFor(keyword);
    const group = resume.skillGroups.find(g => skill?.categories.includes(g.label));
    if (!skill || !group) continue;
    candidates.push({ operation: 'skill_add', section: 'skills', targetId: group.label, itemId: skill.id, order: [], variantIndex: 0, reason: `The job description emphasizes ${keyword}; this skill is in your verified profile.`, jdKeyword: keyword, confidence: 0.9 });
  }
  for (const keyword of [...analysis.matched_keywords, ...analysis.missing_but_verified]) {
    for (const section of ['experience', 'projects']) {
      for (const selected of resume[section]) {
        const entry = profile[section].find(x => x.id === selected.entryId);
        for (const bulletId of selected.bulletIds) {
          const bullet = entry.bullets.find(x => x.id === bulletId);
          for (const [variantIndex, variant] of (bullet.variants ?? []).entries()) {
            if (!containsTerm(variant, keyword)) continue;
            candidates.push({ operation: 'bullet_variant', section, targetId: entry.id, itemId: bulletId, order: [], variantIndex, reason: `Use an existing verified wording that directly mentions ${keyword}.`, jdKeyword: keyword, confidence: 0.85 });
          }
        }
      }
    }
  }
  for (const keyword of analysis.matched_keywords) {
    const relevant = resume.projects.filter(project => projectMatches(profile, project, keyword));
    if (!relevant.length) continue;
    const relevantIds = new Set(relevant.map(project => project.entryId));
    const order = [...relevant, ...resume.projects.filter(project => !relevantIds.has(project.entryId))].map(project => project.entryId);
    if (order.every((id, index) => resume.projects[index].entryId === id)) continue;
    candidates.push({ operation: 'project_reorder', section: 'projects', targetId: 'projects', itemId: '', order, variantIndex: 0, reason: `Put projects that demonstrate ${keyword} before less relevant projects.`, jdKeyword: keyword, confidence: 0.82 });
  }
  for (const keyword of analysis.matched_keywords) {
    const skill = skillFor(keyword);
    for (const group of resume.skillGroups) {
      if (!group.skillIds.includes(skill?.id) || group.skillIds[0] === skill.id) continue;
      candidates.push({ operation: 'skill_reorder', section: 'skills', targetId: group.label, itemId: '', order: [skill.id, ...group.skillIds.filter(id => id !== skill.id)], variantIndex: 0, reason: `Put ${keyword} first in its existing skill group because this posting emphasizes it.`, jdKeyword: keyword, confidence: 0.75 });
    }
    for (const selected of resume.projects) {
      if (!selected.techSkillIds.includes(skill?.id) || selected.techSkillIds[0] === skill.id) continue;
      candidates.push({ operation: 'project_tech_reorder', section: 'projects', targetId: selected.entryId, itemId: '', order: [skill.id, ...selected.techSkillIds.filter(id => id !== skill.id)], variantIndex: 0, reason: `Surface the already listed project technology ${keyword} earlier.`, jdKeyword: keyword, confidence: 0.75 });
    }
    for (const section of ['experience', 'projects']) {
      for (const selected of resume[section]) {
        const entry = profile[section].find(x => x.id === selected.entryId);
        const bulletId = selected.bulletIds.slice(1).find(id => {
          const bullet = entry.bullets.find(x => x.id === id);
          return containsTerm(bullet.text, keyword) || (bullet.skillIds ?? []).includes(skill?.id);
        });
        if (!bulletId) continue;
        candidates.push({ operation: 'bullet_reorder', section, targetId: selected.entryId, itemId: '', order: [bulletId, ...selected.bulletIds.filter(id => id !== bulletId)], variantIndex: 0, reason: `Move the verified ${keyword} example earlier in this entry.`, jdKeyword: keyword, confidence: 0.7 });
      }
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
    if (e.operation === 'experience_title_variant') findSelection(result, 'experience', e.targetId).titleVariant = e.variantIndex;
    else if (e.operation === 'skill_add') result.skillGroups.find(x => x.label === e.targetId).skillIds.push(e.itemId);
    else if (e.operation === 'skill_reorder') result.skillGroups.find(x => x.label === e.targetId).skillIds = [...e.order];
    else if (e.operation === 'project_tech_reorder') findSelection(result, 'projects', e.targetId).techSkillIds = [...e.order];
    else if (e.operation === 'project_reorder') result.projects = e.order.map(id => result.projects.find(project => project.entryId === id));
    else if (e.operation === 'bullet_reorder') findSelection(result, e.section, e.targetId).bulletIds = [...e.order];
    else if (e.operation === 'bullet_variant') {
      result.variants ??= {};
      result.variants[`${e.section}:${e.targetId}:${e.itemId}`] = e.variantIndex;
    }
  }
  return result;
}
