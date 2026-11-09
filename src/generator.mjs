import { performance } from 'node:perf_hooks';
import { randomUUID } from 'node:crypto';
import { normalizeBrief, reviewVariants } from './core.mjs';
import { createProviderRegistry } from './providers.mjs';

export { DEFAULT_MODEL, localVariants, anthropicVariants, foundryVariants } from './providers.mjs';

export async function generate(input, mode = 'local', options = {}) {
  const start = performance.now();
  const brief = normalizeBrief(input);
  const registry = options.registry || createProviderRegistry({ env: options.env || process.env });
  const provider = registry.get(mode);
  const result = await provider.generate(brief, options);
  return {
    brief,
    variants: reviewVariants(result.variants, brief),
    meta: {
      runId: randomUUID(),
      createdAt: new Date().toISOString(),
      mode,
      providerId: provider.id,
      providerLabel: provider.label,
      source: provider.source,
      model: result.model,
      usage: result.usage,
      elapsedMs: Math.round((performance.now() - start) * 100) / 100,
      syntheticExample: input.syntheticExample === true,
    },
  };
}