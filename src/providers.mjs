import { BriefError, buildPrompt, VARIANT_SCHEMA, variantSchema } from './core.mjs';

export const DEFAULT_MODEL = 'claude-haiku-4-5-20251001';

function openingPhrase(script) {
  const firstSentence = script.match(/[^.!?]+[.!?]?/)?.[0] || script;
  return firstSentence.trim().split(/\s+/).slice(0, 16).join(' ').replace(/[.!?]+$/, '');
}

export function localVariants(brief) {
  const pain = brief.pain.replace(/[.!?]+$/, '').split(/\s+/).slice(0, 12).join(' ');
  const opening = openingPhrase(brief.script);
  const fact = brief.facts.find(fact => fact.text.length < 160 && fact.text.split(/\s+/).length <= 16);
  const detail = fact?.text.replace(/[.!?]+$/, '') || `Take a closer look at ${brief.brand}`;
  const productFrame = `Show the ${brief.brand} product from the reference. Keep its appearance unchanged.`;
  if (brief.angleIds) {
    const choices = {
      question: { hooks: [`Still dealing with ${pain}?`, `What would make ${pain} less frustrating?`], screen: 'Another laundry question', frame: 'Begin with the supplied laundry task still unfinished.' },
      complaint: { hooks: [`Laundry day. Then comes ${pain}.`, `The wash is done. Now comes ${pain}.`], screen: 'The unfinished task', frame: 'Show the supplied problem beside a neat stack of folded laundry.' },
      'pattern-interrupt': { hooks: [`A missing poster. For a sock.`, `The sock drawer has a mystery.`], screen: 'A laundry mystery', frame: 'Show a clearly staged missing-sock poster beside the laundry basket.' },
      personification: { hooks: [`The laundry basket has a sock collection.`, `The sock drawer is keeping secrets.`], screen: 'A basket with a secret', frame: 'Give the laundry basket a clearly playful expression using paper props.' },
      story: { hooks: [`POV: you are dealing with ${pain}.`, `Laundry folded. Socks still waiting.`], screen: 'POV: laundry day', frame: 'Film the supplied task from the point of view of the person doing the laundry.' },
      curiosity: { hooks: [`Look closer at ${brief.brand}.`, `Start with the cuffs. Then watch the reference.`], screen: 'A closer look', frame: productFrame },
      benefit: { hooks: [`Look closer: ${detail}.`, `Meet ${brief.brand}, then look at the details.`], screen: `${brief.brand}: details`, frame: productFrame },
      gift: { hooks: [`A gift idea for laundry day.`, `${brief.brand}: a different gift idea.`], screen: 'A laundry-day gift idea', frame: 'Show the unchanged product beside a blank gift note, without new packaging claims.' },
      contrast: { hooks: [`The problem: ${pain}. Now, meet ${brief.brand}.`, `The laundry task. The product detail.`], screen: 'Problem. Product.', frame: 'Cut between the supplied laundry task and the unchanged product, without inventing measured outcomes.' },
    };
    const prefixes = ['', 'On laundry day: ', 'Back to the basket: ', 'A closer look: ', 'For today\'s laundry: ', 'In the sock drawer: '];
    return Array.from({ length: brief.count }, (_, index) => {
      const angle = brief.angleIds[index % brief.angleIds.length];
      const choice = choices[angle];
      const round = Math.floor(index / brief.angleIds.length);
      return {
        angle,
        hook: `${prefixes[Math.floor(round / 2)] || ''}${choice.hooks[round % 2]}`,
        onScreen: choice.screen,
        firstFrame: choice.frame,
        reason: `Uses the selected ${angle} angle while preserving the source body and offer.`,
        factIds: angle === 'benefit' && fact ? [fact.id] : [],
      };
    });
  }
  const recipes = [
    ['Problem-first', `Still dealing with ${pain}?`, 'The familiar laundry problem', 'Show the reference problem in a close-up before revealing the product.', 'Names the supplied pain directly instead of opening with a product pitch.'],
    ['Reference callback', `Start here: "${opening}"`, 'A familiar moment', 'Recreate the reference opening with a different camera angle.', 'Keeps the reference wording while changing the opening delivery and composition.'],
    ['Question', `What would make ${pain} less frustrating?`, 'A different way to pair', 'Start with the unfinished laundry task from the reference.', 'Invites the viewer to consider the supplied problem without inventing an outcome.'],
    ['Product detail', `Look closer: ${detail}.`, `${brief.brand}: a closer look`, productFrame, 'Leads with a supplied product fact rather than a new commercial promise.'],
    ['POV', `POV: you are dealing with ${pain}.`, 'POV: laundry day', 'Shoot the reference task from the person doing the laundry rather than from across the room.', 'Changes the point of view while preserving the original problem.'],
    ['Routine interruption', `Laundry day. Then comes ${pain}.`, 'The part after the wash', 'Show the end of a wash cycle, then cut to the reference problem.', 'Introduces the same pain as a recognisable moment in the routine.'],
    ['Product-first', `Meet ${brief.brand}, then take a closer look.`, `Meet ${brief.brand}`, productFrame, 'Reverses the opening order: product first, original explanation afterwards.'],
    ['Pause and reveal', `Pause here. "${opening}"`, 'Pause at the problem', 'Freeze briefly on the reference problem before cutting to the unchanged product.', 'Adds a visual pause around the original opening instead of changing the offer.'],
    ['Task-first', `${pain.charAt(0).toUpperCase() + pain.slice(1)} again?`, 'The unfinished task', 'Begin with the task still unfinished; use the props already present in the reference.', 'Starts with the supplied task as a question, not a performance guarantee.'],
    ['Direct demonstration', `${brief.brand}, without the sales pitch. Watch the opening.`, 'Start with the product', 'Use a close-up demonstration supported by the verified facts, then return to the reference body.', 'Uses a demonstrative opening; the body carries the unchanged factual explanation.'],
    ['Visual contrast', `The problem: ${pain}. Now, meet ${brief.brand}.`, 'Problem. Product.', 'Cut between the reference problem and the product without claiming a timed before-and-after result.', 'Changes the opening to a problem/product contrast without inventing measured results.'],
    ['Quiet opening', `No big promise. Just ${brief.brand} and a closer look.`, 'A closer look', 'Open silently on the unchanged product, then use the reference voiceover.', 'Uses a quieter delivery rather than adding urgency or an unsupported claim.'],
  ];
  return recipes.slice(0, brief.count).map(([angle, hook, onScreen, firstFrame, reason]) => ({
    angle, hook, onScreen, firstFrame, reason,
    factIds: angle === 'Product detail' && fact ? [fact.id] : [],
  }));
}

export async function anthropicVariants(brief, { client, model, signal, env = process.env } = {}) {
  model ||= env.ANTHROPIC_MODEL || DEFAULT_MODEL;
  if (!client) {
    if (!env.ANTHROPIC_API_KEY) throw new BriefError('Claude is not configured. Set ANTHROPIC_API_KEY on the server or select Local templates.');
    const { default: Anthropic } = await import('@anthropic-ai/sdk');
    client = new Anthropic({ apiKey: env.ANTHROPIC_API_KEY, timeout: 45000, maxRetries: 0 });
  }
  const prompt = buildPrompt(brief);
  const response = await client.messages.create({
    model,
    max_tokens: 3600,
    system: prompt.system,
    messages: [{ role: 'user', content: prompt.user }],
    tools: [{
      name: 'submit_variants',
      description: 'Submit a complete set of English creative-opening modifications for human review. Include the requested number of distinct hooks, concise on-screen copy, shootable frame directions and short explanations. Cite only verified fact IDs from the brief. Do not modify the reference body or offer.',
      input_schema: variantSchema(brief),
    }],
    tool_choice: { type: 'tool', name: 'submit_variants' },
  }, { signal });
  if (response.stop_reason === 'max_tokens') throw new BriefError('Claude output was truncated. Reduce the variant count and try again.');
  const tool = response.content.find(block => block.type === 'tool_use' && block.name === 'submit_variants');
  if (!tool?.input?.variants) throw new BriefError('Claude did not return the expected structured variants. No template fallback was used.');
  return { variants: tool.input.variants, usage: response.usage, model: response.model || model };
}

export function azureEndpoint(value) {
  let endpoint;
  try { endpoint = new URL(value); } catch { throw new BriefError('AZURE_OPENAI_ENDPOINT must be a valid Azure OpenAI HTTPS endpoint.'); }
  const hostAllowed = ['.openai.azure.com', '.services.ai.azure.com'].some(suffix => endpoint.hostname.endsWith(suffix));
  if (endpoint.protocol !== 'https:' || !hostAllowed || endpoint.username || endpoint.password || endpoint.search || endpoint.hash || (endpoint.port && endpoint.port !== '443')) {
    throw new BriefError('Use an Azure OpenAI HTTPS endpoint without credentials, query parameters or a custom port.');
  }
  const path = endpoint.pathname.replace(/\/+$/, '');
  if (path !== '' && path !== '/openai/v1') throw new BriefError('Use the Azure OpenAI endpoint, not the Foundry project endpoint or a completion URL.');
  endpoint.pathname = '/openai/v1/';
  return endpoint.href;
}

export function foundryConfiguration(env = process.env, requireCredential = true) {
  const endpoint = azureEndpoint(env.AZURE_OPENAI_ENDPOINT);
  const deployment = env.AZURE_OPENAI_DEPLOYMENT?.trim();
  if (!deployment || !/^[A-Za-z0-9][A-Za-z0-9_.-]{0,63}$/.test(deployment)) {
    throw new BriefError('Set AZURE_OPENAI_DEPLOYMENT to your Azure deployment name, not a catalog model ID.');
  }
  const auth = env.AZURE_OPENAI_AUTH || 'key';
  if (!['key', 'entra'].includes(auth)) throw new BriefError('AZURE_OPENAI_AUTH must be key or entra.');
  if (requireCredential && auth === 'key' && !env.AZURE_OPENAI_API_KEY) throw new BriefError('Foundry is not configured. Set AZURE_OPENAI_API_KEY locally or configure Microsoft Entra ID.');
  const outputFormat = env.AZURE_OPENAI_OUTPUT_FORMAT || 'json_schema';
  if (!['json_schema', 'json_object'].includes(outputFormat)) throw new BriefError('AZURE_OPENAI_OUTPUT_FORMAT must be json_schema or json_object.');
  return { endpoint, deployment, auth, outputFormat };
}

function portableSchema(value) {
  if (Array.isArray(value)) return value.map(portableSchema);
  if (!value || typeof value !== 'object') return value;
  const unsupported = new Set(['minLength', 'maxLength', 'pattern', 'minItems', 'maxItems']);
  return Object.fromEntries(Object.entries(value).filter(([key]) => !unsupported.has(key)).map(([key, item]) => [key, portableSchema(item)]));
}

export const FOUNDRY_VARIANT_SCHEMA = portableSchema(VARIANT_SCHEMA);

export async function foundryVariants(brief, { client, signal, env = process.env, fetch: customFetch } = {}) {
  const configuration = foundryConfiguration(env, !client);
  if (!client) {
    const { default: OpenAI } = await import('openai');
    let apiKey = env.AZURE_OPENAI_API_KEY;
    if (configuration.auth === 'entra') {
      const { DefaultAzureCredential, getBearerTokenProvider } = await import('@azure/identity');
      apiKey = getBearerTokenProvider(new DefaultAzureCredential(), 'https://ai.azure.com/.default');
    }
    client = new OpenAI({ baseURL: configuration.endpoint, apiKey, timeout: 45000, maxRetries: 0, ...(customFetch ? { fetch: customFetch } : {}) });
  }
  const prompt = buildPrompt(brief, 'json');
  const response = await client.chat.completions.create({
    model: configuration.deployment,
    messages: [{ role: 'system', content: prompt.system }, { role: 'user', content: prompt.user }],
    max_completion_tokens: 4096,
    response_format: configuration.outputFormat === 'json_object'
      ? { type: 'json_object' }
      : { type: 'json_schema', json_schema: { name: 'creative_variants', strict: true, schema: brief.angleIds ? portableSchema(variantSchema(brief)) : FOUNDRY_VARIANT_SCHEMA } },
  }, { signal });
  const choice = response.choices?.[0];
  if (choice?.finish_reason === 'length') throw new BriefError('Foundry output was truncated. Reduce the variant count and try again.');
  if (choice?.message?.refusal || choice?.finish_reason === 'content_filter') throw new BriefError('Foundry declined this request. Review the brief; no template fallback was used.');
  if (choice?.finish_reason !== 'stop' || typeof choice.message?.content !== 'string') throw new BriefError('Foundry did not return a completed JSON response.');
  let parsed;
  try { parsed = JSON.parse(choice.message.content); } catch { throw new BriefError('Foundry returned invalid JSON. No template fallback was used.'); }
  if (!parsed || !Array.isArray(parsed.variants)) throw new BriefError('Foundry did not return the expected variants array.');
  const usage = response.usage ? {
    input_tokens: response.usage.prompt_tokens,
    output_tokens: response.usage.completion_tokens,
    total_tokens: response.usage.total_tokens,
  } : null;
  return { variants: parsed.variants, model: response.model || configuration.deployment, usage };
}

export function createProviderRegistry({ env = process.env, additionalProviders = [] } = {}) {
  const entries = [
    {
      id: 'local', label: 'Local templates', source: 'Local templates; no LLM request',
      status: () => ({ configured: true, model: null, auth: 'none', configurationIssue: null }),
      generate: async brief => ({ variants: localVariants(brief), usage: null, model: null }),
    },
    {
      id: 'foundry', label: 'Microsoft Foundry', source: 'Microsoft Foundry; Azure OpenAI v1',
      status: () => {
        try {
          const configuration = foundryConfiguration(env);
          return { configured: true, model: configuration.deployment, auth: configuration.auth, configurationIssue: null };
        } catch (error) {
          return { configured: false, model: null, auth: null, configurationIssue: error.message };
        }
      },
      generate: (brief, options) => foundryVariants(brief, { ...options, env }),
    },
    {
      id: 'anthropic', label: 'Claude API', source: 'Claude API; structured tool response',
      status: () => ({ configured: Boolean(env.ANTHROPIC_API_KEY), model: env.ANTHROPIC_MODEL || DEFAULT_MODEL, auth: 'key', configurationIssue: env.ANTHROPIC_API_KEY ? null : 'Set ANTHROPIC_API_KEY locally.' }),
      generate: (brief, options) => anthropicVariants(brief, { ...options, env }),
    },
    ...additionalProviders,
  ];
  const providers = new Map();
  for (const entry of entries) {
    if (!/^[a-z][a-z0-9-]*$/.test(entry.id) || typeof entry.label !== 'string' || typeof entry.source !== 'string' || typeof entry.status !== 'function' || typeof entry.generate !== 'function') {
      throw new BriefError('A provider needs id, label, source, status() and generate().');
    }
    if (providers.has(entry.id)) throw new BriefError('Duplicate provider ID.');
    providers.set(entry.id, entry);
  }
  return {
    get(id) {
      const provider = providers.get(id);
      if (!provider) throw new BriefError('Unknown generation provider.');
      return provider;
    },
    list: () => [...providers.values()].map(provider => {
      const status = provider.status();
      return {
        id: provider.id, label: provider.label, configured: status.configured === true,
        model: typeof status.model === 'string' ? status.model : null,
        auth: typeof status.auth === 'string' ? status.auth : null,
        configurationIssue: typeof status.configurationIssue === 'string' ? status.configurationIssue : null,
      };
    }),
    defaultId: () => {
      const id = env.AI_PROVIDER || 'foundry';
      if (!providers.has(id)) throw new BriefError('AI_PROVIDER must match a registered provider.');
      return id;
    },
  };
}