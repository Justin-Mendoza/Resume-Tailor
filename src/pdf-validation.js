import { evidenceCatalog, containsTerm } from './matcher.js';

// PDF typography (ligatures, dashes, spacing) must not change the content check.
const comparable = text => String(text).normalize('NFKD').toLowerCase().replace(/[^\p{L}\p{N}+#]+/gu, '');

export function validatePdfText(text, profile, resume, keywords = []) {
  const errors = [];
  const flat = comparable(text);
  for (const contact of [profile.identity.name, profile.identity.email, profile.identity.phone, ...(profile.identity.links ?? [])].filter(Boolean)) {
    if (!flat.includes(comparable(contact))) errors.push(`Missing contact text: ${contact}`);
  }
  const headings = [resume.experience.length && 'Experience', resume.projects.length && 'Projects', resume.skillGroups.length && 'Technical Skills', resume.education.length && 'Education'].filter(Boolean);
  let position = -1;
  for (const heading of headings) {
    const next = flat.indexOf(comparable(heading), position + 1);
    if (next < 0) errors.push(`Missing or incorrectly ordered heading: ${heading}`);
    else position = next;
  }
  position = -1;
  for (const bullet of evidenceCatalog(profile, resume)) {
    const sectionHeading = bullet.id.startsWith('experience:') ? 'Experience' : 'Projects';
    const endHeading = sectionHeading === 'Experience' && resume.projects.length ? 'Projects' : resume.skillGroups.length ? 'Technical Skills' : 'Education';
    const start = flat.indexOf(comparable(sectionHeading));
    const end = flat.indexOf(comparable(endHeading), start + 1);
    const next = flat.indexOf(comparable(bullet.text), Math.max(position + 1, start));
    if (next < 0 || (end >= 0 && next >= end)) errors.push(`Missing, corrupted, or incorrectly ordered bullet: ${bullet.id}`);
    else position = next;
  }
  for (const section of ['experience', 'projects', 'education']) {
    for (const selected of resume[section]) {
      const entry = profile[section].find(e => e.id === selected.entryId);
      const protectedText = section === 'experience' ? [entry.company, entry.dates, entry.titleVariants[selected.titleVariant]] : section === 'education' ? [entry.school, entry.degree, entry.dates, ...(entry.details ?? [])] : [entry.nameVariants[selected.nameVariant]];
      for (const fact of protectedText.filter(Boolean)) if (!flat.includes(comparable(fact))) errors.push(`Missing or corrupted factual text: ${fact}`);
    }
  }
  const displayedSkillIds = [...resume.skillGroups.flatMap(g => g.skillIds), ...resume.projects.flatMap(p => p.techSkillIds)];
  for (const id of new Set(displayedSkillIds)) {
    const skill = profile.skills.find(s => s.id === id);
    if (!flat.includes(comparable(skill.label))) errors.push(`Missing or corrupted skill: ${skill.label}`);
  }
  for (const keyword of keywords) if (!containsTerm(text, keyword)) errors.push(`Keyword lost in PDF extraction: ${keyword}`);
  if (/\ufffd|\u0000/.test(text)) errors.push('Corrupted characters in extracted text');
  return { passed: errors.length === 0, errors, checkedKeywords: keywords, visualReview: 'Preview required: text extraction cannot establish absence of clipping or overlap.' };
}
