// Catch newly duplicated accomplishment detail, not repeated tool names alone.
// Baseline overlap is allowed; independent approvals must not introduce stuffing.
const stop = new Set('a an the and or of to in on for with by from as so that its it into against through using built engineered designed implemented developed'.split(' '));
const tokens = text => new Set((text.toLowerCase().match(/[a-z0-9]+/g) ?? []).filter(w => w.length > 2 && !stop.has(w)).map(w => w.replace(/(?:ing|ed|s)$/, '')));
function overlap(a, b) {
  const x = tokens(a), y = tokens(b);
  const shared = [...x].filter(w => y.has(w)).length;
  return { shared, containment: shared / Math.max(1, Math.min(x.size, y.size)) };
}
export function introducesRedundancy(originalA, originalB, proposedA, proposedB = originalB) {
  const before = overlap(originalA, originalB), after = overlap(proposedA, proposedB);
  return after.shared >= 10 && after.containment >= 0.6 && after.containment > before.containment + 0.15;
}
export function selectedBulletText(profile, resume, section, entryId, bulletId) {
  const bullet = profile[section]?.find(e => e.id === entryId)?.bullets.find(b => b.id === bulletId);
  const key = `${section}:${entryId}:${bulletId}`;
  return resume.rewrites?.[key] ?? (resume.variants?.[key] === undefined ? bullet?.text : bullet?.variants?.[resume.variants[key]]);
}
export function siblingBullets(profile, resume, section, entryId, bulletId) {
  return (resume[section]?.find(e => e.entryId === entryId)?.bulletIds ?? []).filter(id => id !== bulletId).map(id => ({ id, text: selectedBulletText(profile, resume, section, entryId, id) }));
}
export function duplicatesSibling(profile, resume, section, entryId, bulletId, proposed) {
  const original = selectedBulletText(profile, resume, section, entryId, bulletId);
  return siblingBullets(profile, resume, section, entryId, bulletId).some(b => introducesRedundancy(original, b.text, proposed));
}

// Validate every combination a user can approve: a rewrite must work alongside
// both the original neighbor and any proposed alternative for that neighbor.
export function compatibleBulletChanges(a, b, profile, resume) {
  const x = a.edit, y = b.edit;
  const wording = e => ['bullet_rewrite', 'bullet_variant', 'bullet_replace'].includes(e.operation);
  if (!wording(x) || !wording(y) || x.section !== y.section || x.targetId !== y.targetId || x.itemId === y.itemId) return true;
  const originalA = selectedBulletText(profile, resume, x.section, x.targetId, x.itemId);
  const originalB = selectedBulletText(profile, resume, y.section, y.targetId, y.itemId);
  return !introducesRedundancy(originalA, originalB, a.proposed, b.proposed);
}
