// Broad competencies can be demonstrated without repeating the JD's wording.
// Rules use actual accomplishment text, never an employer name, course list,
// title, or a global Skills declaration as proof of engineering work.
const rules = [
  {
    id: 'developer_workflows',
    request: /developer workflows?|development workflows?|engineering best practices/i,
    evidence: /(?:built|tuned|improved).*CI\/CD pipelines.*(?:reducing|reduced).*deployment time|automat.*onboarding.*(?:manual|provisioning)/i,
    reason: 'Improved deployment pipelines or automated developer onboarding with a verified operational outcome, demonstrating developer workflow improvement.'
  },
  {
    id: 'cloud_infrastructure',
    request: /\bcloud (?:infrastructure|computing|platforms?|environments?)\b/i,
    evidence: /\b(?:AWS|GCP|Azure)\b|cloud (?:providers?|reservations?|capacity)/i,
    reason: 'Implemented cloud infrastructure work using verified cloud providers or capacity/reservation systems.'
  },
  {
    id: 'backend_systems',
    request: /\bback[ -]?end(?: systems?| services?)?\b/i,
    evidence: /ingestion layer|producer and consumer services|(?:built|engineered|implemented|developed).*(?:API endpoints|REST API|backend service)|independent.*services/i,
    reason: 'Implemented ingestion or producer/consumer services demonstrating backend systems experience.'
  },
  {
    id: 'infrastructure_automation',
    request: /(?:infrastructure|cloud|provisioning|onboarding).*automat|automat.*(?:infrastructure|cloud|provisioning|onboarding)/i,
    evidence: /automat.*(?:onboarding|provisioning)|(?:onboarding|provisioning).*automat|CI\/CD pipelines.*(?:OpenShift|Jenkins|ArgoCD)/i,
    reason: 'Automated provisioning/onboarding or deployment pipelines; this is infrastructure automation experience.'
  },
  {
    id: 'cloud_architecture',
    request: /cloud.*(?:architect|design)|(?:architect|design).*cloud/i,
    evidence: /(?:architected|designed).*VPC.*(?:subnets|segment)|provider-agnostic ingestion layer.*(?:AWS|GCP|Azure)/i,
    reason: 'Designed cloud network segmentation or provider abstractions, demonstrating a contribution to cloud architecture.'
  },
  {
    id: 'observability_tools',
    request: /\b(?:observability|monitoring) (?:tools?|tooling|fundamentals)\b/i,
    evidence: /Datadog metrics|(?:implemented|built|added).*(?:logging|monitoring|metrics)/i,
    reason: 'Used observability tooling or implemented telemetry in verified engineering work.'
  },
  {
    id: 'telemetry_bundle',
    request: /monitoring.*(?:alerting|logging)|logging.*(?:monitoring|alerting)/i,
    evidence: /Datadog metrics|(?:implemented|built|added).*(?:logging|monitoring|metrics)/i,
    reason: 'Verified metrics/telemetry work supports part of this requirement, but does not establish all monitoring, alerting, and logging capabilities.'
  },
  {
    id: 'problem_solving',
    request: /problem[ -]?solving|troubleshooting/i,
    evidence: /(?:remediated|resolved|fixed).*(?:vulnerabilit|failure|bug)|(?:tuned|optimized).*(?:reducing|reduced|latency|deployment time)/i,
    reason: 'Resolved security findings or tuned system behavior with a verified outcome, demonstrating engineering problem solving.'
  }
];

export function competencyEvidence(requirement, bullets, { skills, containsTerm }) {
  const requested = requirement.keyword;
  const relevant = rules.filter(r => r.request.test(requested));
  if (!relevant.length) return [];
  const hits = relevant.map(rule => ({ rule, bullets: bullets.filter(b => rule.evidence.test(b.text)) }));
  const isAlternative = /\bor\b/i.test(requested);
  const broadSatisfied = isAlternative ? hits.some(h => h.bullets.length) : hits.every(h => h.bullets.length);
  // Broad evidence must not establish specialized scope or a bundled, complete
  // monitoring + alerting + logging qualification by implication.
  const bundledTelemetry = /monitoring/i.test(requested) && /alerting|logging/i.test(requested);
  const scopeText = `${requested.replace(/(?:such as|for example|e\.g\.).*$/i, '')} ${requirement.source.replace(/(?:such as|for example|e\.g\.).*$/i, '')}`;
  const specialScope = /Terraform|service mesh|Istio|Prometheus|OpenTelemetry|multi[ -]region|multi[ -]tenant|production|at scale|large[ -]scale|senior|expert|leadership|on[ -]call|24\/7|zero[ -]downtime/i.test(scopeText);
  const namedSkills = skills.filter(s => [s.label, ...(s.aliases ?? [])].some(t => containsTerm(requested, t)));
  const missingNamedSkill = namedSkills.some(s => !hits.some(h => h.bullets.some(b => b.skillIds.includes(s.id) || [s.label, ...(s.aliases ?? [])].some(t => containsTerm(b.text, t)))));
  const duration = /\b\d+(?:\.\d+)?\+?\s*(?:years?|yrs?|months?)\b/i.test(`${requested} ${requirement.source}`);
  const satisfied = broadSatisfied && !bundledTelemetry && !specialScope && !missingNamedSkill && !duration;
  return hits.flatMap(({ rule, bullets: evidence }) => evidence.map(b => ({ ...b, assessment: satisfied ? 'equivalent' : 'related', evidence_basis: 'verified_competency', unverified_qualifiers: duration ? ['experience_duration'] : [], rationale: `${rule.reason}${duration ? ' Required experience duration still needs verification; these accomplishments alone do not establish years.' : ''}${bundledTelemetry || specialScope || missingNamedSkill ? ' Additional tools, scope, or bundled capabilities remain unverified.' : ''}` })));
}

export function needsCandidateConfirmation(requirement) {
  return /\bonsite\b|\bon[ -]site\b|in[ -]person (?:attendance|work)|(?:office|in[ -]person) attendance|relocat|work authori[sz]ation|authori[sz]ed to work|eligible to work|visa sponsorship|willing to (?:travel|commute)/i.test(requirement.keyword);
}
