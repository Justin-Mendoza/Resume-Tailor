import { normalize, containsTerm, inferredCompetencies } from './matcher.js';
import { validateSuggestions, combineSuggestions, fallbackSuggestions } from './editor.js';
import { reviewRewrites } from './rewrite-validation.js';

const descriptions = {
  TIMEOUT: 'The model request timed out', NETWORK: 'The model API could not be reached',
  HTTP_ERROR: 'The model API rejected the request', INVALID_RESPONSE: 'The API response was incomplete or not JSON',
  TRUNCATED_RESPONSE: 'The model response was cut off at its output limit', EMPTY_CONTENT: 'The model returned empty content',
  INVALID_JSON: 'The model returned malformed JSON', INVALID_STRUCTURE: 'The model response did not contain a suggested_changes array'
};
function diagnostic(error, stage, started) {
  // Allowlisted metadata only: never echo provider error bodies, prompts, JD,
  // resume text or credentials into logs or browser responses.
  const code = Object.hasOwn(descriptions, error?.code) ? error.code : 'INTERNAL_ERROR';
  const status = Number.isInteger(error?.status) ? error.status : undefined;
  const providerCode = ['request_rejected', 'unsupported_parameter', 'context_length_exceeded', 'model_not_found', 'invalid_model', 'insufficient_quota'].includes(error?.providerCode) ? error.providerCode : undefined;
  const requestId = typeof error?.requestId === 'string' && /^req_[a-zA-Z0-9_-]{6,90}$/.test(error.requestId) ? error.requestId : undefined;
  return { stage, code, status, provider_code: providerCode, request_id: requestId, elapsed_ms: Date.now() - started, message: `${descriptions[code] ?? 'An unexpected processing error occurred'}${status ? ` (HTTP ${status})` : ''}${providerCode ? `; ${providerCode}` : ''}${requestId ? `; request ID: ${requestId}` : ''}.` };
}

export async function refineResume({ provider, input, analysis, profile, resume, existingChanges }) {
  const started = Date.now();
  let raw;
  try {
    raw = await provider.suggestEdits(input);
    if (!Array.isArray(raw?.suggested_changes)) throw Object.assign(new Error(), { code: 'INVALID_STRUCTURE' });
  } catch (error) {
    const diagnostics = diagnostic(error, 'generation', started);
    return { changes: existingChanges, reviews: new Map(), confirmations: [], replaced: false, diagnostics, warning: `AI rewriting failed during generation: ${diagnostics.message} Your verified fallback suggestions are still available.` };
  }
  let reviews = new Map(), confirmations = [], reviewError;
  try {
    ({ reviews, confirmations } = await reviewRewrites(provider, raw.suggested_changes, analysis, profile, resume));
  } catch (error) {
    reviewError = diagnostic(error, 'factual_review', started);
  }
  try {
    const suggestions = validateSuggestions(raw.suggested_changes, analysis, profile, resume, reviews);
    confirmations.push(...(Array.isArray(raw.confirmation_suggestions) ? raw.confirmation_suggestions : []).filter(x => typeof x?.claim === 'string' && typeof x?.question === 'string').map(x => ({ claim: x.claim.slice(0, 500), note: x.question.slice(0, 500) + ' Update verified evidence before use.' })));
    const changes = suggestions.length ? combineSuggestions(suggestions, existingChanges, analysis, profile, resume) : existingChanges;
    const diagnostics = reviewError ?? { stage: 'complete', code: 'OK', elapsed_ms: Date.now() - started, proposed: raw.suggested_changes.length, accepted: suggestions.length, reviewed_rewrites: reviews.size };
    const warning = reviewError ? `AI rewriting finished, but factual review failed: ${reviewError.message} Unreviewed rewrites were withheld; verified edits remain available.` : !suggestions.length ? 'The model returned no edits that passed validation. Your verified fallback suggestions are unchanged.' : '';
    return { changes, reviews, confirmations, replaced: suggestions.length > 0, diagnostics, warning };
  } catch (error) {
    const diagnostics = diagnostic(error, 'validation', started);
    return { changes: existingChanges, reviews: new Map(), confirmations: [], replaced: false, diagnostics, warning: `AI edit validation failed: ${diagnostics.message} Your verified fallback suggestions are unchanged.` };
  }
}

export function prepareRefinement({ jobTitle, analysis, profile, resume }) {
  const relevantSkills = profile.skills.filter(skill => analysis.important_keywords.some(keyword => [skill.label, ...(skill.aliases ?? [])].some(alias => normalize(alias) === normalize(keyword))));
  const relevantBullets = ['experience', 'projects'].flatMap(section => resume[section].map(sel => {
    const entry = profile[section].find(x => x.id === sel.entryId);
    return { section, entryId: entry.id, bulletIds: sel.bulletIds, relevantBullets: entry.bullets.map(({ id }) => {
      const bullet = entry.bullets.find(x => x.id === id);
      const variantIndex = resume.variants?.[`${section}:${entry.id}:${id}`];
      return { id, currentText: variantIndex === undefined ? bullet.text : bullet.variants[variantIndex], variants: bullet.variants ?? [], skillIds: bullet.skillIds ?? [], competencies: inferredCompetencies(bullet.text) };
    }) };
  }));
  const selectedResume = {
    id: resume.id,
    skillGroups: resume.skillGroups.map(group => ({ label: group.label, skills: group.skillIds.map(id => ({ id, label: profile.skills.find(skill => skill.id === id).label })) })),
    projects: resume.projects.map(project => ({ entryId: project.entryId, name: profile.projects.find(entry => entry.id === project.entryId).nameVariants[project.nameVariant], technologies: project.techSkillIds.map(id => ({ id, label: profile.skills.find(skill => skill.id === id).label })) })),
    entries: relevantBullets
  };
  const rewriteOpportunities = relevantBullets.flatMap(entry => entry.relevantBullets.flatMap(target => {
    const mentionsTool = profile.skills.some(skill => [skill.label, ...(skill.aliases ?? [])].some(term => containsTerm(target.currentText, term)));
    if (!/\d/.test(target.currentText) || mentionsTool) return [];
    const words = text => normalize(text).split(' ').map(word => word.replace(/s$/, '')).filter(word => word.length >= 7);
    const anchors = new Set(words(target.currentText));
    const complements = entry.relevantBullets.filter(b => b.id !== target.id && words(b.currentText).some(word => anchors.has(word)) && profile.skills.some(skill => [skill.label, ...(skill.aliases ?? [])].some(term => containsTerm(b.currentText, term))));
    return complements.length ? [{ section: entry.section, entryId: entry.entryId, targetBulletId: target.id, possibleSourceBulletIds: [target.id, ...complements.map(b => b.id)], opportunity: 'Keep impact and implementation bullets distinct; avoid repeating a selected sibling’s mechanism or outcome. Connect the measured outcome to concise relevant implementation details in these same-entry bullets, if they describe the same system. Shared terminology is a lead to investigate, not proof of causality; preserve metric subjects and qualifiers.' }] : [];
  }));
  const suggestions = fallbackSuggestions(analysis, profile, resume);
  const editInput = { jobTitle, jobCategory: analysis.job_category, keywords: analysis.important_keywords, requirements: analysis.requirements, missingButVerified: relevantSkills.filter(skill => analysis.missing_but_verified.some(keyword => [skill.label, ...(skill.aliases ?? [])].some(alias => normalize(alias) === normalize(keyword)))).map(({ id, label, categories }) => ({ id, label, categories })), missingFromSkills: relevantSkills.filter(skill => analysis.missing_from_skills.some(keyword => [skill.label, ...(skill.aliases ?? [])].some(alias => normalize(alias) === normalize(keyword)))).map(({ id, label, categories }) => ({ id, label, categories })), unsupported: analysis.unsupported_keywords, selectedResume, rewriteOpportunities, jobTitleAlignment: analysis.report.job_title_alignment, mode: 'aggressive', safeCandidates: suggestions.map(({ edit, original, proposed, jdKeyword }) => ({ ...edit, original, proposed, jdKeyword })) };
  return { editInput, suggestions };
}
