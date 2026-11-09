import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { once } from 'node:events';
import { createAppServer } from '../src/server.mjs';
import { generate } from '../src/generator.mjs';
import { createProviderRegistry } from '../src/providers.mjs';

const sample = JSON.parse(await readFile(new URL('../samples/briefs.json', import.meta.url), 'utf8'))[0].brief;

async function withServer(callback, options) {
  const server = createAppServer(options);
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  try {
    await callback(`http://127.0.0.1:${server.address().port}`);
  } finally {
    await new Promise(resolveClose => server.close(resolveClose));
  }
}

function post(base, path, payload, headers = {}) {
  return fetch(`${base}${path}`, { method: 'POST', headers: { 'Content-Type': 'application/json', ...headers }, body: JSON.stringify(payload) });
}

test('HTTP workflow generates, requires approval and exports an unchanged offer', async () => {
  await withServer(async base => {
    const response = await post(base, '/api/generate', { brief: sample, mode: 'local' });
    assert.equal(response.status, 200);
    const result = await response.json();
    assert.equal(result.variants.length, 10);
    assert.equal((await post(base, '/api/export', { ...result, format: 'csv' })).status, 422);
    result.variants[0].approved = true;
    const exported = await post(base, '/api/export', { ...result, format: 'csv' });
    assert.equal(exported.status, 200);
    assert.ok((await exported.text()).includes(sample.offer));
    const json = await (await post(base, '/api/export', { ...result, format: 'json' })).json();
    assert.equal(json.variants.length, 1);
    assert.equal(json.brief.script, sample.script);
  });
});

test('export rechecks edited drafts even if the client marks them approved', async () => {
  await withServer(async base => {
    const result = await generate(sample);
    result.variants[0].hook = 'Guaranteed forever, free shipping!';
    result.variants[0].approved = true;
    assert.equal((await post(base, '/api/export', { ...result, format: 'csv' })).status, 422);
  });
});

test('rejects malformed input, foreign origins and excessive requests', async () => {
  await withServer(async base => {
    assert.equal((await post(base, '/api/generate', { brief: { brand: 'SockLock' } })).status, 400);
    assert.equal((await post(base, '/api/generate', { brief: sample }, { Origin: 'https://unrelated.example' })).status, 403);
    assert.equal((await post(base, '/api/generate', { brief: sample, extra: 'x'.repeat(70000) })).status, 413);
    const response = await fetch(`${base}/api/generate`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{broken' });
    assert.equal(response.status, 400);
  });
});

test('configuration exposes no credentials and arbitrary files are inaccessible', async () => {
  await withServer(async base => {
    const response = await fetch(`${base}/api/config`);
    const configuration = await response.json();
    assert.deepEqual(Object.keys(configuration).sort(), ['defaultProvider', 'hasClaudeKey', 'model', 'providers']);
    assert.ok(configuration.providers.some(provider => provider.id === 'foundry'));
    assert.equal((await fetch(`${base}/.env`)).status, 404);
    assert.equal((await fetch(`${base}/src/core.mjs`)).status, 404);
    assert.equal((await fetch(`${base}/deliverables/..%2f.env`)).status, 404);
  });
});

test('provider errors are sanitized without exposing their contents', async () => {
  await withServer(async base => {
    const response = await post(base, '/api/generate', { brief: sample, mode: 'anthropic' });
    assert.equal(response.status, 503);
    assert.doesNotMatch(await response.text(), /sensitive-provider-detail/);
  }, { generateFn: async () => { throw new Error('sensitive-provider-detail'); } });
});

test('registered provider and default are used by HTTP without provider-specific model wiring', async () => {
  const local = await generate(sample);
  const registry = createProviderRegistry({ env: { AI_PROVIDER: 'example' }, additionalProviders: [{ id: 'example', label: 'Example provider', source: 'Test fixture', status: () => ({ configured: true, model: 'fixture-model', apiKey: 'must-not-be-public' }), generate: async () => ({ variants: local.variants, model: 'fixture-model', usage: null }) }] });
  await withServer(async base => {
    const configuration = await (await fetch(`${base}/api/config`)).json();
    assert.equal(configuration.defaultProvider, 'example');
    assert.doesNotMatch(JSON.stringify(configuration), /must-not-be-public/);
    const result = await (await post(base, '/api/generate', { brief: sample })).json();
    assert.equal(result.meta.providerId, 'example');
    assert.equal(result.meta.model, 'fixture-model');
    assert.equal((await post(base, '/api/generate', { brief: sample, provider: 'missing' })).status, 400);
    assert.equal((await post(base, '/api/generate', { brief: sample, provider: 'example', mode: 'local' })).status, 400);
  }, { registry });
});

test('library exposes starter context and validates edited references without generation', async () => {
  await withServer(async base => {
    const library = await (await fetch(`${base}/api/library`)).json();
    assert.equal(library.angles.length, 9);
    assert.ok(library.references.every(reference => reference.synthetic));
    const validated = await post(base, '/api/library/validate', { references: library.references });
    assert.equal(validated.status, 200);
    assert.equal((await post(base, '/api/library/validate', { references: [library.references[0], library.references[0]] })).status, 400);
  });
});