// Split only a narrow, unambiguous conjunction. Do not turn OR alternatives
// into independent mandatory qualifications or erase a bundled qualifier.
export function splitRequirements(rows) {
  return rows.flatMap(row => {
    if (typeof row?.keyword !== 'string') return [row];
    const m = row.keyword.match(/^(?:(?:solid )?understanding of |experience with )?(relational databases?)\s+and\s+(transaction[ -]safe design)$/i);
    return m ? [
      { ...row, keyword: m[1], category: row.category === 'preferred_technical_skill' ? row.category : 'required_technical_skill', evidence: [] },
      { ...row, keyword: m[2], category: 'engineering_competency', evidence: [] }
    ] : [row];
  });
}

export function explicitTechnologyQualifications(jd, rows) {
  return jd.split(/\r?\n/).flatMap(line => {
    const source = line.trim().replace(/^[*•-]\s+/, '');
    const match = source.match(/^Proficiency (?:with|in) (.+?)(?:\s*\(or similar backend technologies\))?[.!]?$/i);
    if (!match || !/\bor\b/i.test(match[1])) return [];
    const keyword = match[1];
    // A model-provided row for this exact source is sufficient; the fallback
    // exists only to recover a qualification omitted from structured analysis.
    if (rows.some(r => r?.source === source && /Python|Django|Go\b/i.test(r.keyword ?? ''))) return [];
    return [{ keyword, source, category: 'required_technical_skill', priority: 'critical' }];
  });
}
