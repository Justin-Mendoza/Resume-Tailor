// Kyma's OpenAI-compatible HTTP format is isolated here so other providers can
// implement the same analyzeJD/suggestEdits interface later.
const MAX_REFINEMENT_TIMEOUT_MS = 120_000;
const DEFAULT_REFINEMENT_TIMEOUT_MS = 60_000;

export function createKymaProvider({ apiKey = process.env.KYMA_API_KEY, model = process.env.KYMA_MODEL || 'qwen3.8-flash', baseUrl = process.env.KYMA_BASE_URL || 'https://kymaapi.com/v1', refinementTimeoutMs = process.env.KYMA_REFINE_TIMEOUT_MS, fetchImpl = fetch, timeoutSignal = AbortSignal.timeout } = {}) {
  const configuredTimeout = Number(refinementTimeoutMs);
  const effectiveRefinementTimeoutMs = Math.min(
    Number.isFinite(configuredTimeout) && configuredTimeout > 0 ? configuredTimeout : DEFAULT_REFINEMENT_TIMEOUT_MS,
    MAX_REFINEMENT_TIMEOUT_MS
  );
  async function request(system, input, timeoutMs) {
    if (!apiKey) throw new Error('KYMA_API_KEY is not set. Add it to .env.');
    const modelId = model === 'qwen-3.8-flash' ? 'qwen3.8-flash' : model;
    const response = await fetchImpl(`${baseUrl.replace(/\/$/, '')}/chat/completions`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ model: modelId, enable_thinking: false, response_format: { type: 'json_object' }, messages: [{ role: 'system', content: system }, { role: 'user', content: JSON.stringify(input) }] }),
      signal: timeoutSignal(timeoutMs)
    });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(`Qwen request failed (${response.status}): ${payload.error?.message ?? 'Unknown error'}`);
    const content = payload.choices?.[0]?.message?.content;
    if (typeof content !== 'string') throw new Error('Qwen returned no JSON response');
    try { return JSON.parse(content); }
    catch { throw new Error('Qwen returned invalid JSON'); }
  }
  return {
    analyzeJD: input => request(
      'Analyze the job description. Respond with JSON only, shaped as {"recommended_resume":"general_swe|ai_search_ml|backend_infra","job_category":"string","important_keywords":["exact phrase from JD"]}. Extract specific technical keywords verbatim from the JD. Recommend a resume category, but do not infer candidate experience.', input, 45000),
    suggestEdits: input => request(
      'Suggest 1 to 5 ATS-relevant, truthful resume adjustments. Respond with JSON only: {"suggested_changes":[{"operation":"skill_add|skill_reorder|project_tech_reorder|project_reorder|bullet_reorder|bullet_variant","section":"skills|experience|projects","targetId":"group label, entry ID, or projects","itemId":"skill or bullet ID, or empty string","order":["IDs for reorder, otherwise empty"],"variantIndex":0,"reason":"short explanation","jdKeyword":"exact keyword from analysis","confidence":0.0}]}. Use ONLY IDs, groups, keywords, and preverified bullet variants supplied. All resume text is fixed verified content. Never write new resume wording, invent facts, or use unsupported JD terms. A skill_add may use only a skill in missingFromSkills and a compatible group. Prefer adding verified skills absent from the Skills section and ordering relevant projects/bullets over cosmetic skill reorders. For unused fields use empty strings, empty arrays, and variantIndex 0.', input, effectiveRefinementTimeoutMs)
  };
}
