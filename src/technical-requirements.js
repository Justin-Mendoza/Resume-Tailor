// Parse simple technology qualifications independently of the model's choice to
// return "Kubernetes" or "Experience with Kubernetes". Unknown technologies and
// extra qualifications remain explicit; they never become verified synonyms.
export function parseTechnicalRequirement(keyword, skills, { normalize, containsTerm }) {
  let expression = normalize(keyword).replace(/\.(?= |$)/g, ' ');
  expression = expression.replace(/^(?:hands on experience|experience|proficiency|knowledge|familiarity|expertise)(?: in| with| of)?\s+/, '').replace(/\s+(?:is )?(?:required|preferred)$/, '');
  const alternatives = expression.split(/\s+(?:and or|or)\s+/);
  const groups = alternatives.map(part => {
    let remaining = ` ${part} `;
    const components = [];
    const candidates = skills.flatMap(s => [s.label, ...(s.aliases ?? [])].map(term => ({ skill: s, term }))).sort((a, b) => b.term.length - a.term.length);
    for (const { skill, term } of candidates) {
      if (!containsTerm(remaining, term)) continue;
      const normalizedTerm = normalize(term);
      remaining = remaining.split(` ${normalizedTerm} `).join(' ');
      const language = skill.id === 'typescript_js' ? /^(?:javascript|js)$/.test(normalizedTerm) ? 'javascript' : normalizedTerm === 'typescript' ? 'typescript' : 'combined' : '';
      const key = `${skill.id}:${language}`;
      if (!components.some(c => c.key === key)) components.push({ key, skillId: skill.id, term });
    }
    const rest = remaining.replace(/\b(?:and|in|with|of|programming|languages?|frameworks?|tools?)\b/g, '').trim();
    return { components, unknown: rest };
  });
  if (!groups.some(g => g.components.length)) return null;
  // Broader competencies (e.g. "observability tools such as Datadog") go to
  // the competency matcher rather than being reduced to a named-tool match.
  const startsWithTechnology = skills.some(s => [s.label, ...(s.aliases ?? [])].some(term => expression === normalize(term) || expression.startsWith(`${normalize(term)} `)));
  if (groups.some(g => g.unknown && !/^[\p{L}\p{N}+#.]+$/u.test(g.unknown)) && !groups.some(g => !g.unknown && g.components.length) && !startsWithTechnology) return null;
  return { groups, alternatives: groups.length > 1 };
}

export function technicalEvidence(parsed, bullets, { skills, containsTerm, skillTerms }, source) {
  if (!parsed) return null;
  const groups = parsed.groups.map(g => ({ ...g, components: g.components.map(c => {
    const skill = skills.find(s => s.id === c.skillId);
    const terms = skillTerms(c.term, skill);
    const evidence = bullets.filter(b => terms.some(t => containsTerm(b.text, t)) || !skill.label.includes('/') && b.skillIds.includes(skill.id));
    return { ...c, evidence };
  }) }));
  const duration = /\b\d+(?:\.\d+)?\+?\s*(?:years?|yrs?|months?)\b/i.test(source);
  const satisfied = !duration && groups.some(g => !g.unknown && g.components.length && g.components.every(c => c.evidence.length));
  const evidence = groups.flatMap(g => g.components.flatMap(c => c.evidence.map(b => ({ ...b, assessment: satisfied ? 'equivalent' : 'related', rationale: `Verified use of ${c.term}.${parsed.alternatives ? ' This is an accepted alternative, so all listed languages are not required.' : ''}${duration ? ' The experience-duration condition still needs verification.' : ''}${g.unknown ? ` Other required terminology remains unsupported: ${g.unknown}.` : ''}` }))));
  return { satisfied, evidence, duration };
}
