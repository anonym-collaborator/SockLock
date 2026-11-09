import assert from 'node:assert/strict';
import { readdir, readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';
import { zipSync, unzipSync } from 'fflate';

const root = fileURLToPath(new URL('../', import.meta.url));
const files = {};
const hashes = {};

async function collect(directory, prefix = '') {
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const relative = `${prefix}${entry.name}`;
    if (['node_modules', 'artifacts', 'test-results', '.git'].includes(entry.name)) continue;
    if (entry.name.startsWith('.env') && entry.name !== '.env.example') continue;
    if (relative === 'deliverables/solution.pdf') continue;
    if (entry.name.endsWith('.zip') || entry.name === 'archive-check.json' || entry.name === 'manifest.json') continue;
    if (entry.isDirectory()) await collect(resolve(directory, entry.name), `${relative}/`);
    else if (entry.isFile()) {
      const bytes = new Uint8Array(await readFile(resolve(directory, entry.name)));
      files[`socklock-variants/${relative}`] = bytes;
      hashes[relative] = createHash('sha256').update(bytes).digest('hex');
    }
  }
}

await collect(root);
const required = ['package.json', 'package-lock.json', 'README.md', '.env.example', 'src/core.mjs', 'src/providers.mjs', 'src/generator.mjs', 'src/server.mjs', 'public/index.html', 'samples/briefs.json', 'samples/creative-library.json', 'deliverables/video-defense.mp4', 'deliverables/demo.mp4', 'deliverables/verification.json', 'deliverables/economics.json'];
for (const name of required) assert.ok(files[`socklock-variants/${name}`], `Missing required file: ${name}`);
const manifest = { packagedAt: new Date().toISOString(), files: hashes, criteriaWeights: { workingMVP: 45, problemAndPitch: 20, selectionAndEconomics: 20, successMetrics: 15 }, liveClaudeEvaluated: false, liveFoundryEvaluated: false, businessPilotPerformed: false };
const manifestBytes = new TextEncoder().encode(JSON.stringify(manifest, null, 2));
files['socklock-variants/deliverables/manifest.json'] = manifestBytes;
await writeFile(resolve(root, 'deliverables/manifest.json'), manifestBytes);
const archive = zipSync(files, { level: 6 });
const archivePath = resolve(root, 'deliverables/submission.zip');
await writeFile(archivePath, archive);
const extracted = unzipSync(new Uint8Array(await readFile(archivePath)));
const names = Object.keys(extracted);
assert.equal(names.length, Object.keys(files).length);
assert.ok(names.every(name => !name.includes('/node_modules/') && !name.includes('/artifacts/') && !name.endsWith('/.env')));
assert.ok(names.every(name => !name.endsWith('.pdf')), 'PDF files must not be included in the submission archive');
for (const [name, bytes] of Object.entries(files)) {
  assert.equal(createHash('sha256').update(extracted[name]).digest('hex'), createHash('sha256').update(bytes).digest('hex'), `Archive integrity mismatch: ${name}`);
}
const report = { checkedAt: new Date().toISOString(), fileCount: names.length, sizeBytes: archive.length, verifiedHashes: true, excludesCredentials: true, excludesNodeModules: true, containsPDF: false, containsRecordedMP4: true, containsVideoDefense: true };
await writeFile(resolve(root, 'deliverables/archive-check.json'), JSON.stringify(report, null, 2));
console.log(JSON.stringify(report, null, 2));