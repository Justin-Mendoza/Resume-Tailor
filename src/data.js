import { readFile } from 'node:fs/promises';
import path from 'node:path';

export const RESUME_IDS = ['general_swe', 'ai_search_ml', 'backend_infra'];
const root = path.resolve(import.meta.dirname, '..');

function requireString(value, label) {
  if (typeof value !== 'string' || !value.trim()) throw new Error(`Invalid ${label}`);
}

function uniqueIds(items, label) {
  if (!Array.isArray(items)) throw new Error(`${label} must be an array`);
  const ids = new Set();
  for (const item of items) {
    requireString(item.id, `${label} ID`);
    if (ids.has(item.id)) throw new Error(`Duplicate ${label} ID: ${item.id}`);
    ids.add(item.id);
  }
  return ids;
}

export function validateData(profile, resumes) {
  if (!profile || typeof profile !== 'object') throw new Error('Missing verified profile');
  requireString(profile.identity?.name, 'identity name');
  const skillIds = uniqueIds(profile.skills, 'skill');
  for (const skill of profile.skills) {
    requireString(skill.label, `skill ${skill.id} label`);
    if (!Array.isArray(skill.categories)) throw new Error(`Missing categories for skill ${skill.id}`);
    if (skill.aliases !== undefined && (!Array.isArray(skill.aliases) || skill.aliases.some(x => typeof x !== 'string'))) {
      throw new Error(`Invalid aliases for skill ${skill.id}`);
    }
  }
  for (const section of ['experience', 'projects', 'education']) {
    uniqueIds(profile[section], section);
    for (const entry of profile[section]) {
      for (const field of section === 'education' ? ['school', 'degree', 'dates'] : section === 'experience' ? ['company', 'dates'] : []) {
        requireString(entry[field], `${section} ${entry.id} ${field}`);
      }
      if (section === 'experience' && !entry.titleVariants?.length) throw new Error(`Missing titles for ${entry.id}`);
      if (section === 'projects' && !entry.nameVariants?.length) throw new Error(`Missing names for ${entry.id}`);
      if (section === 'education') continue;
      uniqueIds(entry.bullets, `${section} ${entry.id} bullet`);
      for (const bullet of entry.bullets) {
        requireString(bullet.text, `bullet ${bullet.id} text`);
        for (const variant of bullet.variants ?? []) requireString(variant, `bullet ${bullet.id} variant`);
        for (const id of bullet.skillIds ?? []) if (!skillIds.has(id)) throw new Error(`Unknown skill ${id} in bullet ${bullet.id}`);
      }
    }
  }
  for (const id of RESUME_IDS) {
    const resume = resumes[id];
    if (!resume || resume.id !== id) throw new Error(`Missing resume ${id}`);
    for (const group of resume.skillGroups ?? []) {
      requireString(group.label, `${id} group label`);
      for (const skillId of group.skillIds ?? []) {
        const skill = profile.skills.find(x => x.id === skillId);
        if (!skill) throw new Error(`Unknown skill ${skillId} in ${id}`);
        if (!skill.categories.includes(group.label)) throw new Error(`Skill ${skillId} is not verified for ${group.label}`);
      }
    }
    for (const section of ['experience', 'projects', 'education']) {
      for (const selected of resume[section] ?? []) {
        const entry = profile[section].find(x => x.id === selected.entryId);
        if (!entry) throw new Error(`Unknown ${section} entry ${selected.entryId} in ${id}`);
        if (section === 'experience' && !entry.titleVariants[selected.titleVariant]) throw new Error(`Invalid title variant in ${id}`);
        if (section === 'projects') {
          if (!entry.nameVariants[selected.nameVariant]) throw new Error(`Invalid project name variant in ${id}`);
          for (const skillId of selected.techSkillIds ?? []) if (!skillIds.has(skillId)) throw new Error(`Unknown project technology ${skillId} in ${id}`);
        }
        if (section !== 'education') {
          for (const bulletId of selected.bulletIds ?? []) {
            if (!entry.bullets.some(x => x.id === bulletId)) throw new Error(`Unknown bullet ${bulletId} in ${id}`);
          }
        }
      }
    }
    for (const [key, index] of Object.entries(resume.variants ?? {})) {
      const [section, entryId, bulletId] = key.split(':');
      if (!['experience', 'projects'].includes(section) || !Number.isInteger(index) || !profile[section].find(e => e.id === entryId)?.bullets.find(b => b.id === bulletId)?.variants?.[index]) throw new Error(`Invalid verified wording variant ${key}`);
    }
  }
  return true;
}

export async function loadData() {
  const profile = JSON.parse(await readFile(path.join(root, 'data/verified_experience.json'), 'utf8'));
  const resumes = Object.fromEntries(await Promise.all(RESUME_IDS.map(async id => [id, JSON.parse(await readFile(path.join(root, `data/resumes/${id}.json`), 'utf8'))])));
  validateData(profile, resumes);
  return { profile, resumes };
}

export function isConfigured(profile, resumes) {
  return profile.skills.length > 0 && RESUME_IDS.every(id => {
    const r = resumes[id];
    return (r.skillGroups?.length ?? 0) + (r.experience?.length ?? 0) + (r.projects?.length ?? 0) > 0;
  });
}
