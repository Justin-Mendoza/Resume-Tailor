import { createKymaProvider } from './kyma.js';

export function createProvider(config = {}) {
  const name = config.provider ?? process.env.LLM_PROVIDER ?? 'kyma';
  if (name === 'kyma') return createKymaProvider(config);
  throw new Error(`Unknown LLM provider: ${name}. Add an adapter in src/providers/.`);
}
