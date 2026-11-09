import assert from 'node:assert/strict';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { resolve } from 'node:path';
import { once } from 'node:events';
import { chromium, expect } from '@playwright/test';
import { startServer, createAppServer } from '../src/server.mjs';
import { generate } from '../src/generator.mjs';
import { createProviderRegistry } from '../src/providers.mjs';

const root = fileURLToPath(new URL('../', import.meta.url));
const evidence = resolve(root, 'deliverables');
await mkdir(evidence, { recursive: true });
const server = await startServer(0);
const base = `http://127.0.0.1:${server.address().port}`;
const browser = await chromium.launch({ headless: true });
const checks = [];
const failures = [];
const screenshotNames = [];

try {
  const context = await browser.newContext({ viewport: { width: 1440, height: 1000 }, acceptDownloads: true, reducedMotion: 'reduce' });
  const page = await context.newPage();
  page.on('pageerror', error => failures.push(error.message));
  await page.goto(base);
  await expect(page.locator('#provider-select')).toBeEnabled();
  const configuration = await (await fetch(`${base}/api/config`)).json();
  await expect(page.locator('#provider-select')).toHaveValue(configuration.defaultProvider);
  assert.ok(configuration.providers.some(provider => provider.id === 'foundry'));
  await page.locator('#provider-select').selectOption('local');
  checks.push('Provider selector is built from the server registry and respects the configured default.');
  await expect(page.locator('#sample-select')).toHaveCount(0);
  await expect(page.locator('#script')).toHaveValue('');
  await page.getByRole('button', { name: 'Insert example', exact: true }).click();
  await expect(page.locator('#script')).not.toHaveValue('');
  await expect(page.locator('#angle-options input:checked')).toHaveCount(9);
  checks.push('Reference dropdown is removed; Insert example explicitly fills a synthetic brief.');
  await page.evaluate(() => document.fonts.ready);
  assert.equal(await page.locator('.reference-row img').evaluate(image => image.complete && image.naturalWidth > 0), true);
  assert.equal(await page.evaluate(() => document.fonts.check('13px "Manrope Variable"')), true);
  checks.push('Local photo, font and icons load without external CDN requests.');
  await page.getByRole('button', { name: 'Generate variants', exact: true }).click();
  await expect(page.locator('.variant-card')).toHaveCount(10);
  await expect(page.getByRole('button', { name: 'Export approved', exact: true })).toBeDisabled();
  await expect(page.locator('#batch-status')).toContainText('Local templates');
  checks.push('Generates ten local-template drafts, explicitly labeled, with no automatic approvals.');

  await page.getByRole('button', { name: 'Edit V01', exact: true }).click();
  await page.locator('#edit-hook').fill('Guaranteed forever, free shipping only today!');
  await page.getByRole('button', { name: 'Save and recheck', exact: true }).click();
  await expect(page.locator('[data-variant-id="V01"] .status-tag')).toHaveText('Blocked');
  await expect(page.getByRole('button', { name: 'Approve V01', exact: true })).toBeDisabled();
  checks.push('Editing a draft to add an invented guarantee/promotion blocks human approval.');

  await page.getByRole('button', { name: 'Edit V01', exact: true }).click();
  await page.locator('#edit-hook').fill('One basket. Another loose sock to match.');
  await page.getByRole('button', { name: 'Save and recheck', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Approve V01', exact: true })).toBeEnabled();
  await page.getByRole('button', { name: 'Approve V01', exact: true }).click();
  await expect(page.locator('#approved-count')).toHaveText('1');
  const csvDownloadPromise = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Export approved', exact: true }).click();
  const csvDownload = await csvDownloadPromise;
  const csvPath = resolve(evidence, 'sample-approved.csv');
  await csvDownload.saveAs(csvPath);
  const csv = await readFile(csvPath, 'utf8');
  assert.ok(csv.includes('One basket. Another loose sock to match.'));
  assert.ok(csv.includes('Subscription: five pairs for $29; a new delivery every quarter.'));
  assert.ok(csv.includes('human-approved draft'));
  assert.ok(!csv.includes('"V02"'));
  checks.push('Approved CSV contains only approved drafts and the unchanged reference body/offer.');
  await page.locator('#export-format').selectOption('json');
  const jsonDownloadPromise = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Export approved', exact: true }).click();
  const jsonDownload = await jsonDownloadPromise;
  const jsonPath = resolve(evidence, 'sample-approved.json');
  await jsonDownload.saveAs(jsonPath);
  assert.equal(JSON.parse(await readFile(jsonPath, 'utf8')).variants.length, 1);
  checks.push('Approved JSON export is valid structured data.');
  await page.screenshot({ path: resolve(evidence, 'desktop.png'), fullPage: true, animations: 'disabled' });
  screenshotNames.push('desktop.png');

  const workspaceDownloadPromise = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Save workspace', exact: true }).click();
  const workspaceDownload = await workspaceDownloadPromise;
  const workspacePath = resolve(evidence, 'sample-workspace.json');
  await workspaceDownload.saveAs(workspacePath);
  await page.locator('#pain').fill('a changed customer pain requiring a new batch');
  await expect(page.locator('#workspace-alert')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Export approved', exact: true })).toBeDisabled();
  await page.locator('#project-file').setInputFiles(workspacePath);
  await expect(page.locator('#approved-count')).toHaveText('0');
  await expect(page.locator('.variant-card')).toHaveCount(10);
  checks.push('Brief edits invalidate approval; workspace import rechecks all drafts and resets approvals.');

  if (!configuration.providers.find(provider => provider.id === 'anthropic')?.configured) {
    await page.locator('#provider-select').selectOption('anthropic');
    await page.getByRole('button', { name: 'Generate variants', exact: true }).click();
    await expect(page.locator('#form-error')).toContainText('not configured');
    await expect(page.locator('#batch-status')).toContainText('Local templates');
    checks.push('Missing API configuration is displayed explicitly, without silently replacing a Claude request.');
  }
  if (!configuration.providers.find(provider => provider.id === 'foundry')?.configured) {
    await page.locator('#provider-select').selectOption('foundry');
    await page.getByRole('button', { name: 'Generate variants', exact: true }).click();
    await expect(page.locator('#form-error')).toBeVisible();
    await expect(page.locator('#batch-status')).toContainText('Local templates');
    checks.push('Missing Foundry configuration is explicit; the previous batch retains its real local-template provenance.');
  }
  await page.locator('#provider-select').selectOption('local');
  await page.locator('#pain').fill('matching socks <img src=x onerror="window.injected=true">');
  await page.getByRole('button', { name: 'Generate variants', exact: true }).click();
  await expect(page.locator('.variant-card')).toHaveCount(10);
  assert.equal(await page.evaluate(() => window.injected), undefined);
  assert.equal(await page.locator('.variant-card img').count(), 0);
  checks.push('User-provided markup is rendered as text, not executable HTML.');

  for (const viewport of [{ width: 390, height: 844, name: 'mobile' }, { width: 1024, height: 768, name: 'laptop' }]) {
    const responsiveContext = await browser.newContext({ viewport, reducedMotion: 'reduce' });
    const responsivePage = await responsiveContext.newPage();
    responsivePage.on('pageerror', error => failures.push(error.message));
    await responsivePage.goto(base);
    await expect(responsivePage.locator('#provider-select')).toBeEnabled();
    await responsivePage.locator('#provider-select').selectOption('local');
    await responsivePage.getByRole('button', { name: 'Insert example', exact: true }).click();
    await responsivePage.getByRole('button', { name: 'Generate variants', exact: true }).click();
    await expect(responsivePage.locator('.variant-card')).toHaveCount(10);
    await expect(responsivePage.getByRole('button', { name: 'Generate variants', exact: true })).toBeEnabled();
    const layout = await responsivePage.evaluate(() => ({
      viewport: innerWidth,
      document: document.documentElement.scrollWidth,
      overflowingControls: [...document.querySelectorAll('button,input,select,textarea')].filter(node => node.clientWidth && node.scrollWidth > node.clientWidth + 2).map(node => node.id || node.textContent.trim()),
      imageLoaded: document.querySelector('.reference-row img').naturalWidth > 0,
    }));
    assert.ok(layout.document <= layout.viewport + 1, JSON.stringify(layout));
    assert.deepEqual(layout.overflowingControls, [], JSON.stringify(layout));
    assert.ok(layout.imageLoaded);
    await responsivePage.screenshot({ path: resolve(evidence, `${viewport.name}.png`), fullPage: true, animations: 'disabled' });
    screenshotNames.push(`${viewport.name}.png`);
    checks.push(`${viewport.width}px viewport: generation works, image loads, no horizontal page/control overflow.`);
    await responsiveContext.close();
  }

  const samples = JSON.parse(await readFile(resolve(root, 'samples/briefs.json'), 'utf8'));
  const fixtureRegistry = createProviderRegistry({ env: { AI_PROVIDER: 'foundry', AZURE_OPENAI_ENDPOINT: 'https://fixture-resource.openai.azure.com', AZURE_OPENAI_DEPLOYMENT: 'fixture-deployment', AZURE_OPENAI_API_KEY: 'test-only-key' } });
  const fixtureClient = { chat: { completions: { create: async payload => {
    const submitted = JSON.parse(payload.messages[1].content);
    const fixture = await generate(submitted);
    return { model: 'fixture-model', choices: [{ finish_reason: 'stop', message: { content: JSON.stringify({ variants: fixture.variants }) } }], usage: { prompt_tokens: 100, completion_tokens: 200, total_tokens: 300 } };
  } } } };
  const fixtureServer = createAppServer({ registry: fixtureRegistry, generateFn: async (input, provider, options) => {
    const result = await generate(input, provider, { ...options, ...(provider === 'foundry' ? { client: fixtureClient } : {}) });
    if (provider === 'foundry') result.meta.source = 'TEST FIXTURE: mocked Foundry client; no Azure inference request';
    return result;
  } });
  fixtureServer.listen(0, '127.0.0.1');
  await once(fixtureServer, 'listening');
  try {
    const foundryPage = await browser.newPage({ viewport: { width: 1024, height: 768 } });
    foundryPage.on('pageerror', error => failures.push(error.message));
    await foundryPage.goto(`http://127.0.0.1:${fixtureServer.address().port}`);
    await expect(foundryPage.locator('#provider-select')).toHaveValue('foundry');
    await expect(foundryPage.locator('#provider-status')).toContainText('Configured');
    await foundryPage.getByRole('button', { name: 'Insert example', exact: true }).click();
    await foundryPage.getByRole('button', { name: 'Generate variants', exact: true }).click();
    await expect(foundryPage.locator('.variant-card')).toHaveCount(10);
    await expect(foundryPage.locator('#batch-status')).toContainText('Microsoft Foundry');
    await expect(foundryPage.locator('#run-source')).toContainText('TEST FIXTURE');
    await foundryPage.getByRole('button', { name: 'Approve V01', exact: true }).click();
    const foundryDownloadPromise = foundryPage.waitForEvent('download');
    await foundryPage.getByRole('button', { name: 'Export approved', exact: true }).click();
    const foundryDownload = await foundryDownloadPromise;
    assert.equal(foundryDownload.suggestedFilename(), 'socklock-approved.csv');
    checks.push('Configured Foundry selector, generation, provenance, human approval and export work end-to-end with an explicitly mocked client.');
    await foundryPage.close();
  } finally {
    await new Promise(resolveClose => fixtureServer.close(resolveClose));
  }

  const libraryPage = await context.newPage();
  libraryPage.on('pageerror', error => failures.push(error.message));
  await libraryPage.goto(base);
  await expect(libraryPage.locator('#provider-select')).toBeEnabled();
  await libraryPage.locator('#provider-select').selectOption('local');
  await libraryPage.getByRole('button', { name: 'Insert example', exact: true }).click();
  await libraryPage.getByRole('button', { name: 'Clear angle selection', exact: true }).click();
  await expect(libraryPage.getByRole('button', { name: 'Generate variants', exact: true })).toBeDisabled();
  await libraryPage.getByRole('checkbox', { name: 'Question', exact: true }).check();
  await libraryPage.getByRole('checkbox', { name: 'Story / POV', exact: true }).check();
  await libraryPage.locator('#reference-library').evaluate(node => { node.open = true; });
  await libraryPage.getByRole('checkbox', { name: 'Use Laundry POV', exact: true }).check();
  await libraryPage.getByRole('button', { name: 'View reference Laundry POV', exact: true }).click();
  assert.equal(await libraryPage.locator('#reference-script').evaluate(node => node.readOnly), true);
  await expect(libraryPage.locator('#save-reference')).toBeHidden();
  await libraryPage.getByRole('button', { name: 'Close reference', exact: true }).click();
  checks.push('Angles are selectable, an empty selection cannot generate, and references can be viewed read-only.');

  await libraryPage.getByRole('button', { name: 'Add script', exact: true }).click();
  await libraryPage.locator('#reference-name').fill('Test style script');
  await libraryPage.locator('#reference-script').fill('A fictional laundry-day opening with a playful scene. This is a style example, not a verified claim.');
  await libraryPage.locator('#reference-synthetic').check();
  await libraryPage.getByRole('button', { name: 'Save reference', exact: true }).click();
  await expect(libraryPage.getByRole('checkbox', { name: 'Use Test style script', exact: true })).toBeChecked();
  const generationResponse = libraryPage.waitForResponse(response => response.url().endsWith('/api/generate'));
  await libraryPage.getByRole('button', { name: 'Generate variants', exact: true }).click();
  const generated = await (await generationResponse).json();
  assert.deepEqual(generated.brief.angleIds, ['question', 'story']);
  assert.ok(generated.brief.references.some(reference => reference.title === 'Test style script'));
  assert.ok(generated.variants.every(variant => ['question', 'story'].includes(variant.angle) && !variant.blocked));
  checks.push('Selected angles and added reference scripts reach the generation API and are preserved in the returned brief.');

  await libraryPage.getByRole('button', { name: 'Edit reference Test style script', exact: true }).click();
  await libraryPage.locator('#reference-script').fill('An edited fictional style example. Show a staged laundry basket, without changing the commercial offer.');
  await libraryPage.getByRole('button', { name: 'Save reference', exact: true }).click();
  await expect(libraryPage.locator('#workspace-alert')).toBeVisible();
  await expect(libraryPage.getByRole('button', { name: 'Export approved', exact: true })).toBeDisabled();
  await libraryPage.getByRole('button', { name: 'Generate variants', exact: true }).click();
  await expect(libraryPage.getByRole('button', { name: 'Generate variants', exact: true })).toBeEnabled();
  const libraryWorkspacePromise = libraryPage.waitForEvent('download');
  await libraryPage.getByRole('button', { name: 'Save workspace', exact: true }).click();
  const libraryWorkspacePath = resolve(evidence, 'sample-library-workspace.json');
  await (await libraryWorkspacePromise).saveAs(libraryWorkspacePath);
  await libraryPage.reload();
  await expect(libraryPage.locator('#provider-select')).toBeEnabled();
  await libraryPage.locator('#reference-library').evaluate(node => { node.open = true; });
  await expect(libraryPage.getByRole('checkbox', { name: 'Use Test style script', exact: true })).toBeVisible();
  await libraryPage.locator('#project-file').setInputFiles(libraryWorkspacePath);
  await expect(libraryPage.getByRole('checkbox', { name: 'Use Test style script', exact: true })).toBeChecked();
  await expect(libraryPage.getByRole('checkbox', { name: 'Question', exact: true })).toBeChecked();
  await expect(libraryPage.getByRole('checkbox', { name: 'Gift', exact: true })).not.toBeChecked();
  checks.push('Editing a selected reference invalidates approval; library scripts survive reload and selected context survives workspace import.');

  const libraryDownloadPromise = libraryPage.waitForEvent('download');
  await libraryPage.getByRole('button', { name: 'Export reference library', exact: true }).click();
  const libraryPath = resolve(evidence, 'sample-reference-library.json');
  await (await libraryDownloadPromise).saveAs(libraryPath);
  libraryPage.once('dialog', dialog => dialog.accept());
  await libraryPage.getByRole('button', { name: 'Delete reference Test style script', exact: true }).click();
  await expect(libraryPage.getByRole('checkbox', { name: 'Use Test style script', exact: true })).toHaveCount(0);
  libraryPage.once('dialog', dialog => dialog.accept());
  await libraryPage.locator('#library-file').setInputFiles(libraryPath);
  await expect(libraryPage.getByRole('checkbox', { name: 'Use Test style script', exact: true })).toHaveCount(1);
  checks.push('Reference libraries support JSON export/import and deletion, with explicit confirmation.');
  await libraryPage.screenshot({ path: resolve(evidence, 'reference-library.png'), fullPage: true, animations: 'disabled' });
  screenshotNames.push('reference-library.png');
  await libraryPage.close();

  const times = [];
  for (let index = 0; index < 50; index += 1) times.push((await generate(samples[index % samples.length].brief)).meta.elapsedMs);
  times.sort((first, second) => first - second);
  const result = await generate(samples[0].brief);
  await writeFile(resolve(evidence, 'sample-output.json'), JSON.stringify(result, null, 2));
  assert.deepEqual(failures, []);
  const report = {
    checkedAt: new Date().toISOString(),
    checks,
    browserErrors: failures,
    screenshots: screenshotNames,
    localGeneration: { samples: 50, variantsPerSample: 10, medianMs: times[25], p95Ms: times[47] },
    claudeVerification: 'SDK contract tested with mock responses. Live Claude generation was not evaluated; no API key provided.',
    foundryVerification: 'Official OpenAI SDK request tested with a stub HTTP transport; browser workflow tested with an explicitly mocked client. No live Azure inference request or charge was made.',
    businessValidation: 'Not performed: no real designers, winning creative exports or live ad access. The pilot metrics in README are targets, not measured outcomes.',
  };
  await writeFile(resolve(evidence, 'verification.json'), JSON.stringify(report, null, 2));
  console.log(JSON.stringify(report, null, 2));
} finally {
  await browser.close();
  await new Promise(resolveClose => server.close(resolveClose));
}