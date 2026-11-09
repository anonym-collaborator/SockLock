import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { normalizeBrief } from '../src/core.mjs';
import { generate } from '../src/generator.mjs';
import { createProviderRegistry, azureEndpoint, foundryConfiguration, foundryVariants } from '../src/providers.mjs';

const brief = JSON.parse(await readFile(new URL('../samples/briefs.json', import.meta.url), 'utf8'))[0].brief;
const environment = { AZURE_OPENAI_ENDPOINT: 'https://example-resource.openai.azure.com', AZURE_OPENAI_DEPLOYMENT: 'demo-deployment', AZURE_OPENAI_API_KEY: 'not-a-real-key' };

function mockClient(response) {
  return { chat: { completions: { create: async () => response } } };
}

test('registry can add a provider without changing the generator', async () => {
  const local = await generate(brief);
  const registry = createProviderRegistry({ additionalProviders: [{ id: 'example', label: 'Example model', source: 'Injected test provider', status: () => ({ configured: true, model: 'test-model' }), generate: async () => ({ variants: local.variants, model: 'test-model', usage: null }) }] });
  const result = await generate(brief, 'example', { registry });
  assert.equal(result.meta.providerId, 'example');
  assert.equal(result.meta.providerLabel, 'Example model');
  assert.equal(result.brief.offer, brief.offer);
  assert.ok(result.variants.every(variant => !variant.approved));
});

test('registry rejects duplicates, unknown providers and incorrect defaults', () => {
  const registry = createProviderRegistry({ env: { AI_PROVIDER: 'missing' } });
  assert.throws(() => registry.get('missing'), /Unknown generation provider/);
  assert.throws(() => registry.defaultId(), /registered provider/);
  assert.throws(() => createProviderRegistry({ additionalProviders: [{ id: 'local', label: 'Duplicate', source: 'Test', status: () => ({}), generate: async () => ({}) }] }), /Duplicate/);
});

test('endpoint normalization accepts account roots and v1 URLs but rejects unsafe/project URLs', () => {
  assert.equal(azureEndpoint(environment.AZURE_OPENAI_ENDPOINT), 'https://example-resource.openai.azure.com/openai/v1/');
  assert.equal(azureEndpoint('https://example-resource.services.ai.azure.com/openai/v1/'), 'https://example-resource.services.ai.azure.com/openai/v1/');
  for (const endpoint of ['http://example-resource.openai.azure.com', 'https://unrelated.example/openai/v1', 'https://name:password@example-resource.openai.azure.com', 'https://example-resource.services.ai.azure.com/api/projects/demo', 'https://example-resource.openai.azure.com/?api-key=secret']) {
    assert.throws(() => azureEndpoint(endpoint));
  }
});

test('public provider status never includes credentials or a raw invalid endpoint', () => {
  const registry = createProviderRegistry({ env: environment });
  const status = registry.list();
  assert.equal(status.find(provider => provider.id === 'foundry').configured, true);
  assert.doesNotMatch(JSON.stringify(status), /not-a-real-key|example-resource/);
  const invalid = createProviderRegistry({ env: { ...environment, AZURE_OPENAI_ENDPOINT: 'https://name:private-value@example-resource.openai.azure.com' } }).list();
  assert.doesNotMatch(JSON.stringify(invalid), /private-value/);
});

test('Foundry has explicit key and Entra configuration, with no credential fallback', () => {
  assert.throws(() => foundryConfiguration({ ...environment, AZURE_OPENAI_API_KEY: '' }), /not configured/);
  assert.equal(foundryConfiguration({ ...environment, AZURE_OPENAI_AUTH: 'entra', AZURE_OPENAI_API_KEY: '' }).auth, 'entra');
  assert.throws(() => foundryConfiguration({ ...environment, AZURE_OPENAI_AUTH: 'automatic' }), /key or entra/);
});

test('Foundry sends its deployment and portable schema, preserving the common contract', async () => {
  const local = await generate(brief);
  let request;
  let options;
  const client = mockClient({});
  client.chat.completions.create = async (payload, suppliedOptions) => {
    request = payload;
    options = suppliedOptions;
    return { model: 'service-model', choices: [{ finish_reason: 'stop', message: { content: JSON.stringify({ variants: local.variants }) } }], usage: { prompt_tokens: 100, completion_tokens: 200, total_tokens: 300 } };
  };
  const controller = new AbortController();
  const result = await generate(brief, 'foundry', { client, env: environment, signal: controller.signal });
  assert.equal(request.model, 'demo-deployment');
  assert.equal(request.max_completion_tokens, 4096);
  assert.equal(request.response_format.json_schema.strict, true);
  assert.doesNotMatch(JSON.stringify(request.response_format.json_schema.schema), /maxLength|minItems|pattern/);
  assert.doesNotMatch(request.messages[0].content, /submit_variants tool/);
  assert.equal(options.signal, controller.signal);
  assert.equal(result.meta.mode, 'foundry');
  assert.equal(result.meta.usage.output_tokens, 200);
  assert.equal(result.variants.length, 10);
});

test('JSON-object output is an explicit configured capability, never an automatic retry', async () => {
  const local = await generate(brief);
  let request;
  const client = mockClient({});
  client.chat.completions.create = async payload => {
    request = payload;
    return { choices: [{ finish_reason: 'stop', message: { content: JSON.stringify({ variants: local.variants }) } }] };
  };
  await foundryVariants(normalizeBrief(brief), { client, env: { ...environment, AZURE_OPENAI_OUTPUT_FORMAT: 'json_object' } });
  assert.deepEqual(request.response_format, { type: 'json_object' });
});

test('Foundry refuses truncated, filtered, invalid and incomplete responses', async () => {
  const responses = [
    [{ choices: [{ finish_reason: 'length', message: { content: '{}' } }] }, /truncated/],
    [{ choices: [{ finish_reason: 'content_filter', message: { content: '{}' } }] }, /declined/],
    [{ choices: [{ finish_reason: 'stop', message: { refusal: 'not permitted', content: '{}' } }] }, /declined/],
    [{ choices: [{ finish_reason: 'stop', message: { content: 'not-json' } }] }, /invalid JSON/],
    [{ choices: [{ finish_reason: 'stop', message: { content: '{}' } }] }, /variants array/],
    [{ choices: [] }, /completed JSON/],
  ];
  for (const [response, expected] of responses) await assert.rejects(foundryVariants(normalizeBrief(brief), { client: mockClient(response), env: environment }), expected);
});

test('shared review also blocks unsafe claims returned by a newly added provider', async () => {
  const local = await generate(brief);
  local.variants[0].hook = 'Guaranteed results forever!';
  const client = mockClient({ choices: [{ finish_reason: 'stop', message: { content: JSON.stringify({ variants: local.variants }) } }] });
  const result = await generate(brief, 'foundry', { client, env: environment });
  assert.ok(result.variants[0].blocked);
});

test('official OpenAI SDK uses Azure v1 with a stub transport and no network request', async () => {
  const local = await generate(brief);
  let calls = 0;
  const transport = async (url, options) => {
    calls += 1;
    assert.equal(String(url), 'https://example-resource.openai.azure.com/openai/v1/chat/completions');
    const request = JSON.parse(options.body);
    assert.equal(request.model, 'demo-deployment');
    assert.equal(request.response_format.type, 'json_schema');
    const headers = new Headers(options.headers);
    assert.equal(headers.get('authorization'), 'Bearer not-a-real-key');
    return new Response(JSON.stringify({ id: 'chatcmpl-fixture', object: 'chat.completion', created: 0, model: 'fixture-model', choices: [{ index: 0, finish_reason: 'stop', message: { role: 'assistant', content: JSON.stringify({ variants: local.variants }) } }], usage: { prompt_tokens: 100, completion_tokens: 200, total_tokens: 300 } }), { headers: { 'Content-Type': 'application/json' } });
  };
  const result = await generate(brief, 'foundry', { env: environment, fetch: transport });
  assert.equal(calls, 1);
  assert.equal(result.meta.usage.total_tokens, 300);
  assert.equal(result.variants.length, 10);
});

test('Foundry receives a portable selected-angle schema and style context', async () => {
  const input = { ...brief, angleIds: ['question', 'gift'], references: [{ id: 'style', title: 'Style only', script: 'A fictional laundry-day example used for tone, not facts.', synthetic: true }] };
  const local = await generate(input);
  let captured;
  const client = mockClient({});
  client.chat.completions.create = async request => {
    captured = request;
    return { choices: [{ finish_reason: 'stop', message: { content: JSON.stringify({ variants: local.variants }) } }] };
  };
  const result = await generate(input, 'foundry', { client, env: environment });
  assert.deepEqual(captured.response_format.json_schema.schema.properties.variants.items.properties.angle.enum, ['question', 'gift']);
  assert.equal(JSON.parse(captured.messages[1].content).references[0].id, 'style');
  assert.ok(result.variants.every(variant => !variant.blocked));
});