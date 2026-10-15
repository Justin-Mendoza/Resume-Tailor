import { containsTerm, normalize } from './matcher.js';
import { checkRewrite, rewriteSources, reviewKey } from './rewrite-validation.js';

const sameSet = (a, b) => a.length === b.length && new Set(a).size === a.length && new Set(b).size === b.length && a.every(x => b.includes(x));
const clone = value => structuredClone(value);
const metrics = text => (text.match(/(?:[$~≈]\s*)?\d[\d,]*(?:\.\d+)?(?:\s*(?:%|\+|x|×))?/g) ?? []).sort();

export function validateBulletRewrite(original, proposed, profile) {
  if (JSON.stringify(metrics(original)) !== JSON.stringify(metrics(proposed))) return false;
  // A verified alternative must also retain every technology explicitly named
  // in the selected wording. Related technologies cannot replace each other.
  return profile.skills.every(skill => {
    const terms = [skill.label, ...(skill.aliases ?? [])];
    if (skill.label.includes('/')) return terms.every(t => !containsTerm(original, t) || containsTerm(proposed, t));
    return !terms.some(t => containsTerm(original, t)) || terms.some(t => containsTerm(proposed, t));
  });
}


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

function currentBulletText(profile, resume, section, entryId, bulletId) {
  const key = `${section}:${entryId}:${bulletId}`;
  return resume.rewrites?.[key] ?? bulletText(profile, section, entryId, bulletId, resume.variants?.[key] ?? -1);
}

const priorityWeight = { critical: 4, high: 3, medium: 2, low: 1 };
function skillWeight(id, analysis) {
  return Math.max(0, ...(analysis.requirements ?? []).filter(r => r.verified_skill_id === id).map(r => priorityWeight[r.priority] ?? 0));
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

function entryLabel(profile, section, entryId) {
  const entry = profile[section]?.find(item => item.id === entryId);
  return entry?.company ?? entry?.nameVariants?.[0] ?? entryId;
}

function projectName(profile, selection) {
  const entry = profile.projects.find(project => project.id === selection.entryId);
  return entry.nameVariants[selection.nameVariant];
}

export function buildChange(raw, analysis, profile, resume, reviews = new Map()) {
  if (!raw || typeof raw !== 'object') return null;
  const keyword = analysis.important_keywords.find(x => normalize(x) === normalize(raw.jdKeyword));
  if (!keyword || analysis.unsupported_keywords.some(x => normalize(x) === normalize(keyword))) return null;
  const reason = String(raw.reason ?? '').trim().slice(0, 240);
  if (!reason) return null;
  const confidence = Number(raw.confidence);
  if (!Number.isFinite(confidence) || confidence < 0 || confidence > 1) return null;
  const base = { operation: raw.operation, section: raw.section, targetId: raw.targetId, itemId: raw.itemId, order: raw.order, variantIndex: raw.variantIndex, proposed: raw.proposed, sourceBulletIds: raw.sourceBulletIds };
  let original, proposed, title, conflictKey;
  if (raw.operation === 'skill_add' && raw.section === 'skills') {
    const group = resume.skillGroups.find(x => x.label === raw.targetId);
    const skill = profile.skills.find(x => x.id === raw.itemId);
    if (!group || !skill || group.skillIds.includes(skill.id) || !skill.categories.includes(group.label) || !analysis.missing_from_skills?.some(x => normalize(x) === normalize(keyword))) return null;
    if (![skill.label, ...(skill.aliases ?? [])].some(x => normalize(x) === normalize(keyword))) return null;
    original = group.skillIds.map(id => profile.skills.find(x => x.id === id).label).join(', ');
    proposed = [...group.skillIds, skill.id].map(id => profile.skills.find(x => x.id === id).label).join(', ');
    title = `Add verified skill · ${group.label}`;
    conflictKey = `skill:${group.label}:${skill.id}`;
  } else if (raw.operation === 'skill_optimize' && raw.section === 'skills') {
    const group = resume.skillGroups.find(x => x.label === raw.targetId);
    if (!group || !Array.isArray(raw.order) || new Set(raw.order).size !== raw.order.length || !group.skillIds.every(id => raw.order.includes(id))) return null;
    const added = raw.order.filter(id => !group.skillIds.includes(id));
    if (!raw.order.every(id => profile.skills.some(skill => skill.id === id && skill.categories.includes(group.label)))) return null;
    if (!added.every(id => analysis.requirements.some(r => r.verified_skill_id === id))) return null;
    const weight = id => skillWeight(id, analysis);
    if (!added.length && group.skillIds.every((id, i) => id === raw.order[i])) return null;
    // The new sequence must put more important skills first, with stable ties.
    if (raw.order.some((id, i) => i > 0 && weight(raw.order[i - 1]) < weight(id))) return null;
    original = group.skillIds.map(id => profile.skills.find(s => s.id === id).label).join(', ');
    proposed = raw.order.map(id => profile.skills.find(s => s.id === id).label).join(', ');
    title = `Optimize verified skills · ${group.label}`;
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
    title = `Reorder project technologies · ${entryLabel(profile, raw.section, raw.targetId)}`;
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
    original = sel.bulletIds.map(id => `• ${currentBulletText(profile, resume, raw.section, raw.targetId, id)}`).join('\n');
    proposed = raw.order.map(id => `• ${currentBulletText(profile, resume, raw.section, raw.targetId, id)}`).join('\n');
    title = `Reorder bullets · ${entryLabel(profile, raw.section, raw.targetId)}`;
    conflictKey = `entry:${raw.section}:${raw.targetId}`;
  } else if (raw.operation === 'bullet_rewrite' && ['experience', 'projects'].includes(raw.section)) {
    const sel = findSelection(resume, raw.section, raw.targetId);
    const sources = rewriteSources(profile, raw.section, raw.targetId, raw.sourceBulletIds);
    original = currentBulletText(profile, resume, raw.section, raw.targetId, raw.itemId);
    const review = reviews.get(reviewKey(raw));
    if (!sel?.bulletIds.includes(raw.itemId) || !sources || !raw.sourceBulletIds.includes(raw.itemId) || !review || review.original !== original || review.proposed !== raw.proposed || JSON.stringify(review.sources) !== JSON.stringify(sources) || !checkRewrite(original, raw.proposed, sources, profile, analysis)) return null;
    proposed = raw.proposed;
    title = `Strengthen accomplishment · ${entryLabel(profile, raw.section, raw.targetId)}`;
    conflictKey = `bullet:${raw.section}:${raw.targetId}:${raw.itemId}`;
  } else if (raw.operation === 'bullet_replace' && ['experience', 'projects'].includes(raw.section)) {
    const sel = findSelection(resume, raw.section, raw.targetId);
    const replacement = findBullet(profile, raw.section, raw.targetId, raw.replacementId);
    if (!sel?.bulletIds.includes(raw.itemId) || sel.bulletIds.includes(raw.replacementId) || !replacement || !containsTerm(replacement.text, keyword)) return null;
    original = currentBulletText(profile, resume, raw.section, raw.targetId, raw.itemId);
    proposed = replacement.text;
    base.replacementId = raw.replacementId;
    title = `Select relevant accomplishment · ${entryLabel(profile, raw.section, raw.targetId)}`;
    conflictKey = `entry:${raw.section}:${raw.targetId}`;
  } else if (raw.operation === 'bullet_variant' && ['experience', 'projects'].includes(raw.section)) {
    const sel = findSelection(resume, raw.section, raw.targetId);
    const bullet = findBullet(profile, raw.section, raw.targetId, raw.itemId);
    if (!sel?.bulletIds.includes(raw.itemId) || !bullet || !Number.isInteger(raw.variantIndex) || !bullet.variants?.[raw.variantIndex]) return null;
    if (!containsTerm(bullet.variants[raw.variantIndex], keyword)) return null;
    original = currentBulletText(profile, resume, raw.section, raw.targetId, raw.itemId);
    proposed = bullet.variants[raw.variantIndex];
    if (original === proposed || containsTerm(original, keyword) || !validateBulletRewrite(original, proposed, profile)) return null;
    title = `Use verified wording · ${entryLabel(profile, raw.section, raw.targetId)}`;
    conflictKey = `bullet:${raw.section}:${raw.targetId}:${raw.itemId}`;
  } else return null;
  if (raw.original !== undefined && raw.original !== original) return null;
  return { id: '', title, original, proposed, reason, jdKeyword: keyword, confidence, conflictKey, evidence: raw.operation === 'bullet_rewrite' ? reviews.get(reviewKey(raw)).sources : analysis.requirements?.find(r => normalize(r.keyword) === normalize(keyword))?.evidence ?? [], edit: base };
}

function conflictsWith(change, existing) {
  if (change.conflictKey === existing.conflictKey) return true;
  const a = change.edit, b = existing.edit;
  if (a.section !== b.section || a.targetId !== b.targetId) return false;
  if (a.operation === 'skill_optimize' || b.operation === 'skill_optimize') return true;
  if (a.operation === 'bullet_replace' || b.operation === 'bullet_replace') return true;
  return false;
}

export function validateSuggestions(rawSuggestions, analysis, profile, resume, reviews = new Map()) {
  const changes = [];
  for (const raw of (Array.isArray(rawSuggestions) ? rawSuggestions : [])) {
    const change = buildChange(raw, analysis, profile, resume, reviews);
    if (!change || changes.some(existing => conflictsWith(change, existing))) continue;
    change.id = `change_${changes.length + 1}`;
    changes.push(change);
  }
  return changes;
}

// Preserve substantive, validated local edits when Qwen returns only cosmetic
// reorders. Both inputs must already have passed buildChange/validateSuggestions.
export function combineSuggestions(qwenChanges, existingChanges, analysis = {}) {
  const priority = change => ({ critical: -1, high: 0, medium: 1, low: 2 })[analysis.requirements?.find(r => r.keyword === change.jdKeyword)?.priority] ?? 1;
  const rank = change => ({ bullet_rewrite: -1, bullet_replace: 0, skill_optimize: 0, skill_add: 0, bullet_variant: 1, project_reorder: 2, bullet_reorder: 3, project_tech_reorder: 4, skill_reorder: 5 })[change.edit.operation] ?? 6;
  const ordered = [...qwenChanges.map(change => ({ change, source: 0 })), ...existingChanges.map(change => ({ change, source: 1 }))]
    .sort((a, b) => priority(a.change) - priority(b.change) || rank(a.change) - rank(b.change) || a.source - b.source);
  const combined = [];
  for (const { change } of ordered) {
    if (combined.some(existing => conflictsWith(change, existing))) continue;
    combined.push({ ...change, id: `change_${combined.length + 1}` });
  }
  return combined;
}

export function fallbackSuggestions(analysis, profile, resume) {
  const candidates = [];
  const skillFor = keyword => profile.skills.find(s => [s.label, ...(s.aliases ?? [])].some(x => normalize(x) === normalize(keyword)));
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
      candidates.push({ operation: 'skill_reorder', section: 'skills', targetId: group.label, itemId: '', order: [...group.skillIds].sort((a, b) => skillWeight(b, analysis) - skillWeight(a, analysis)), variantIndex: 0, reason: `Order verified skills by job requirement priority, including ${keyword}.`, jdKeyword: keyword, confidence: 0.75 });
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
  const priority = { critical: -1, high: 0, medium: 1, low: 2 };
  candidates.sort((a, b) => (priority[analysis.requirements?.find(r => r.keyword === a.jdKeyword)?.priority] ?? 1) - (priority[analysis.requirements?.find(r => r.keyword === b.jdKeyword)?.priority] ?? 1));
  return combineSuggestions(validateSuggestions(candidates, analysis, profile, resume), [], analysis);
}

export function applyApproved(resume, changes, approvedIds) {
  const result = clone(resume);
  const known = new Set(changes.map(x => x.id));
  if (!Array.isArray(approvedIds) || approvedIds.some(id => !known.has(id)) || new Set(approvedIds).size !== approvedIds.length) throw new Error('Invalid approved change IDs');
  for (const change of changes.filter(x => approvedIds.includes(x.id))) {
    const e = change.edit;
    if (e.operation === 'skill_add') result.skillGroups.find(x => x.label === e.targetId).skillIds.push(e.itemId);
    else if (e.operation === 'skill_optimize') result.skillGroups.find(x => x.label === e.targetId).skillIds = [...e.order];
    else if (e.operation === 'skill_reorder') result.skillGroups.find(x => x.label === e.targetId).skillIds = [...e.order, ...result.skillGroups.find(x => x.label === e.targetId).skillIds.filter(id => !e.order.includes(id))];
    else if (e.operation === 'project_tech_reorder') findSelection(result, 'projects', e.targetId).techSkillIds = [...e.order];
    else if (e.operation === 'project_reorder') result.projects = e.order.map(id => result.projects.find(project => project.entryId === id));
    else if (e.operation === 'bullet_reorder') findSelection(result, e.section, e.targetId).bulletIds = [...e.order];
    else if (e.operation === 'bullet_rewrite') {
      result.rewrites ??= {};
      result.rewrites[`${e.section}:${e.targetId}:${e.itemId}`] = change.proposed;
    }
    else if (e.operation === 'bullet_replace') {
      const selection = findSelection(result, e.section, e.targetId);
      selection.bulletIds = selection.bulletIds.map(id => id === e.itemId ? e.replacementId : id);
    }
    else if (e.operation === 'bullet_variant') {
      result.variants ??= {};
      result.variants[`${e.section}:${e.targetId}:${e.itemId}`] = e.variantIndex;
    }
  }
  return result;
}
