// Month-only display dates describe an interval, not exact tenure. Only explicit
// candidate-confirmed durations can satisfy a numeric experience prerequisite.
const months = { jan: 0, feb: 1, mar: 2, apr: 3, may: 4, jun: 5, jul: 6, aug: 7, sep: 8, oct: 9, nov: 10, dec: 11 };
function month(value) {
  const m = value.trim().match(/^([A-Za-z]+)\.?\s+(\d{4})$/);
  return m && months[m[1].slice(0, 3).toLowerCase()] !== undefined ? Number(m[2]) * 12 + months[m[1].slice(0, 3).toLowerCase()] : null;
}
export function experienceCatalog(profile, resume, now = new Date()) {
  return (resume.experience ?? []).flatMap(sel => {
    const entry = profile.experience.find(e => e.id === sel.entryId);
    const title = entry?.titleVariants[sel.titleVariant];
    if (!entry || !/software engineer|software developer/i.test(title)) return [];
    const dates = entry.dates.split(/[–—]|\s-\s/).map(month);
    const estimated = dates.length === 2 && dates.every(x => x !== null) && dates[1] >= dates[0] ? dates[1] - dates[0] + 1 : null;
    const elapsed = estimated !== null && dates[1] < now.getFullYear() * 12 + now.getMonth();
    const confirmed = elapsed && Number.isFinite(entry.verifiedDurationMonths) && entry.verifiedDurationMonths > 0 && entry.verifiedDurationMonths <= estimated ? entry.verifiedDurationMonths : null;
    return [{ id: `experience:${entry.id}`, text: `${entry.company}: ${title}; ${entry.dates}`, start: dates[0], end: dates[1], estimated_months: estimated, verified_months: confirmed, internship: /intern/i.test(title) }];
  });
}
function durationMinimum(text) {
  // Mixed-unit ranges: "6 months to 2 years" still have a six-month minimum.
  const match = text.match(/\b(\d+(?:\.\d+)?)\s*(?:[-–—]\s*\d+(?:\.\d+)?)?\s*\+?\s*(months?|years?|yrs?)\b/i);
  return match ? Number(match[1]) * (/month/i.test(match[2]) ? 1 : 12) : null;
}
export function workExperienceEvidence(requirement, profile, resume) {
  const text = `${requirement.keyword} ${requirement.source}`;
  const minimum = durationMinimum(text);
  if (minimum === null || !/(?:software engineering|software development|software engineer|hands.on).*experience|experience.*(?:software engineering|software development)/i.test(text)) return null;
  // Broad software tenure must not establish a specialized technology, domain,
  // seniority or production prerequisite bundled into the same requirement.
  const namedTechnology = profile.skills.filter(s => !['english', 'french'].includes(s.id)).some(s => [s.label, ...(s.aliases ?? [])].some(term => {
    const escaped = term.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    return new RegExp(`(?<![a-z0-9])${escaped}(?![a-z0-9])`, 'i').test(text);
  }));
  const specialized = namedTechnology || /senior|expert|leadership|production|cloud|back.?end|financial|fintech|distributed|payments|on.call|management/i.test(text);
  const rows = experienceCatalog(profile, resume).filter(e => !/excluding internships|non.intern|full.time/i.test(text) || !e.internship);
  const overlapping = rows.some((a, i) => rows.slice(i + 1).some(b => a.start === null || b.start === null || a.start <= b.end && b.start <= a.end));
  const verified = rows.length > 0 && !overlapping && rows.every(r => Number.isFinite(r.verified_months));
  const total = verified ? rows.reduce((n, r) => n + r.verified_months, 0) : null;
  const satisfied = !specialized && total !== null && total >= minimum;
  return { satisfied, verified_months: total, minimum_months: minimum, evidence: rows.map(row => ({ ...row, assessment: satisfied ? 'equivalent' : 'related', rationale: `${total !== null ? `${total} candidate-confirmed months across non-overlapping software engineering roles` : 'Role dates support software engineering experience, but exact qualifying duration needs confirmation'}; minimum requested: ${minimum} months.${specialized ? ' Specialized scope still needs separate evidence.' : ''}` })) };
}
