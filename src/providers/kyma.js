// Kyma's OpenAI-compatible HTTP format is isolated here so other providers can
// implement the same analyzeJD/suggestEdits interface later.
export function createKymaProvider({ apiKey = process.env.KYMA_API_KEY, model = process.env.KYMA_MODEL || 'qwen3.8-flash', baseUrl = process.env.KYMA_BASE_URL || 'https://kymaapi.com/v1', fetchImpl = fetch } = {}) {
  async function request(system, input, timeoutMs) {
    if (!apiKey) throw new Error('KYMA_API_KEY is not set. Add it to .env.');
    const modelId = model === 'qwen-3.8-flash' ? 'qwen3.8-flash' : model;
    const response = await fetchImpl(`${baseUrl.replace(/\/$/, '')}/chat/completions`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ model: modelId, enable_thinking: false, response_format: { type: 'json_object' }, messages: [{ role: 'system', content: system }, { role: 'user', content: JSON.stringify(input) }] }),
      signal: AbortSignal.timeout(timeoutMs)
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
      'Suggest 1 to 5 small, truthful resume adjustments. Respond with JSON only: {"suggested_changes":[{"operation":"skill_add|skill_reorder|project_tech_reorder|bullet_reorder|bullet_variant","section":"skills|experience|projects","targetId":"group label or entry ID","itemId":"skill or bullet ID, or empty string","order":["IDs for reorder, otherwise empty"],"variantIndex":0,"reason":"short explanation","jdKeyword":"exact keyword from analysis","confidence":0.0}]}. Use ONLY IDs, groups, keywords, and preverified bullet variants supplied. All resume text is fixed verified content. Never write new resume wording, invent facts, or use unsupported JD terms. A skill_add must put a verified skill into a compatible group. For unused fields use empty strings, empty arrays, and variantIndex 0.', input, 25000)
  };
}
