import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { generate } from '../src/generator.mjs';

const samples = JSON.parse(await readFile(new URL('../samples/briefs.json', import.meta.url), 'utf8'));

test('offline mode produces ten distinct, usable structured drafts from each example', async () => {
  for (const sample of samples) {
    const result = await generate(sample.brief);
    assert.equal(result.variants.length, 10);
    assert.equal(new Set(result.variants.map(variant => variant.hook)).size, 10);
    assert.ok(result.variants.every(variant => !variant.blocked));
    assert.equal(result.brief.offer, sample.brief.offer);
    assert.equal(result.meta.mode, 'local');
    assert.equal(result.meta.usage, null);
  }
});

test('local generation actually changes with the customer pain and reference', async () => {
  const first = await generate(samples[0].brief);
  const second = await generate(samples[1].brief);
  assert.notEqual(first.variants[0].hook, second.variants[0].hook);
  assert.notEqual(first.variants[1].hook, second.variants[1].hook);
});

test('every supported count is respected', async () => {
  for (const count of [4, 6, 10, 12]) {
    const result = await generate({ ...samples[0].brief, count });
    assert.equal(result.variants.length, count);
  }
});

test('Claude adapter requests a constrained tool response and retains usage', async () => {
  const local = await generate(samples[0].brief);
  let captured;
  const client = { messages: { create: async request => {
    captured = request;
    return { stop_reason: 'tool_use', model: 'test-model', usage: { input_tokens: 100, output_tokens: 200 }, content: [{ type: 'tool_use', name: 'submit_variants', input: { variants: local.variants } }] };
  } } };
  const result = await generate(samples[0].brief, 'anthropic', { client });
  assert.equal(captured.tool_choice.name, 'submit_variants');
  assert.equal(result.meta.usage.output_tokens, 200);
  assert.equal(result.meta.mode, 'anthropic');
  assert.equal(result.meta.model, 'test-model');
});

test('provider failure is surfaced instead of being disguised as local generation', async () => {
  const client = { messages: { create: async () => { throw new Error('Provider unavailable'); } } };
  await assert.rejects(generate(samples[0].brief, 'anthropic', { client }), /Provider unavailable/);
});

test('truncated and malformed provider responses are rejected', async () => {
  const client = { messages: { create: async () => ({ stop_reason: 'max_tokens', content: [] }) } };
  await assert.rejects(generate(samples[0].brief, 'anthropic', { client }), /truncated/);
  client.messages.create = async () => ({ stop_reason: 'end_turn', content: [] });
  await assert.rejects(generate(samples[0].brief, 'anthropic', { client }), /expected structured/);
});

test('local generation uses only selected angles and balances their distribution', async () => {
  const result = await generate({ ...samples[0].brief, angleIds: ['gift', 'question'] });
  assert.deepEqual([...new Set(result.variants.map(variant => variant.angle))], ['gift', 'question']);
  assert.equal(result.variants.filter(variant => variant.angle === 'gift').length, 5);
  assert.ok(result.variants.every(variant => !variant.blocked));
  const oneAngle = await generate({ ...samples[0].brief, angleIds: ['question'], count: 4 });
  assert.equal(new Set(oneAngle.variants.map(variant => variant.hook)).size, 4);
});

test('Claude receives selected angle IDs in its schema and references in its prompt', async () => {
  const input = { ...samples[0].brief, angleIds: ['question', 'gift'], references: [{ id: 'example', title: 'Style example', script: 'A fictional example of a laundry-day gift opening.', synthetic: true }] };
  const local = await generate(input);
  let captured;
  const client = { messages: { create: async request => {
    captured = request;
    return { stop_reason: 'tool_use', content: [{ type: 'tool_use', name: 'submit_variants', input: { variants: local.variants } }] };
  } } };
  await generate(input, 'anthropic', { client });
  assert.deepEqual(captured.tools[0].input_schema.properties.variants.items.properties.angle.enum, ['question', 'gift']);
  assert.equal(JSON.parse(captured.messages[0].content).references[0].title, 'Style example');
});