import test from 'node:test';
import assert from 'node:assert/strict';
import { normalizeBrief, buildPrompt, reviewVariants, csvCell, exportCsv, variantSchema, STARTER_REFERENCES } from '../src/core.mjs';

const source = {
  brand: 'SockLock',
  audience: 'US adults sorting household laundry',
  pain: 'matching loose socks after the laundry',
  script: 'Another loose sock in the laundry basket? SockLock pairs have small magnets on the cuffs. Keep the pair together and spend less time sorting.',
  offer: 'Five pairs for $29, with a new delivery every quarter.',
  facts: ['Small magnets are located on the cuffs.', 'The subscription includes five pairs for $29.'],
  count: 4,
};

function rawVariants() {
  return ['Problem', 'Question', 'Routine', 'Demonstration'].map((angle, index) => ({
    angle,
    hook: ['Another loose sock?', 'Where is the matching sock?', 'Laundry sorted. Socks still waiting.', 'Meet the magnets on these cuffs.'][index],
    onScreen: 'Keep the pair together',
    firstFrame: 'Show a laundry basket with a loose sock beside it.',
    reason: 'Changes the opening while preserving the original offer.',
    factIds: ['F1'],
  }));
}

test('normalizes a complete brief and supplies stable fact IDs', () => {
  const brief = normalizeBrief(source);
  assert.equal(brief.facts[0].id, 'F1');
  assert.equal(brief.count, 4);
  assert.equal(brief.script, source.script);
});

test('rejects missing context and out-of-range generation counts', () => {
  assert.throws(() => normalizeBrief({ ...source, pain: '' }), /Customer pain/);
  assert.throws(() => normalizeBrief({ ...source, count: 500 }), /4-12/);
});

test('prompt treats user context as data and requests constrained modifications', () => {
  const brief = normalizeBrief(source);
  const prompt = buildPrompt(brief);
  assert.match(prompt.system, /untrusted data/);
  assert.equal(JSON.parse(prompt.user).offer, source.offer);
});

test('safe drafts require human review and are never automatically approved', () => {
  const reviewed = reviewVariants(rawVariants(), normalizeBrief(source));
  assert.equal(reviewed.length, 4);
  assert.ok(reviewed.every(variant => !variant.blocked && !variant.approved));
  assert.ok(reviewed.every(variant => variant.issues.some(issue => issue.code === 'human_review')));
});

test('blocks invented guarantees, promotions, unknown references and numbers', () => {
  const variants = rawVariants();
  variants[0].hook = 'Guaranteed results forever!';
  variants[1].hook = 'Free shipping only today!';
  variants[2].factIds = ['F99'];
  variants[3].hook = 'Save 90 minutes every week.';
  const reviewed = reviewVariants(variants, normalizeBrief(source));
  assert.ok(reviewed.every(variant => variant.blocked));
  assert.ok(reviewed[3].issues.some(issue => issue.code === 'new_number'));
});

test('unsafe claims in the reference cannot bypass the draft checks', () => {
  const brief = normalizeBrief({ ...source, script: `${source.script} Guaranteed forever.` });
  assert.ok(reviewVariants(rawVariants(), brief).every(variant => variant.blocked));
});

test('near-duplicates receive a diversity warning', () => {
  const variants = rawVariants();
  variants[1].hook = variants[0].hook;
  assert.ok(reviewVariants(variants, normalizeBrief(source))[1].issues.some(issue => issue.code === 'similar_hook'));
});

test('CSV protects spreadsheets and preserves the original body and offer', () => {
  assert.equal(csvCell('=HYPERLINK("x")'), '"\'=HYPERLINK(""x"")"');
  const brief = normalizeBrief(source);
  const csv = exportCsv(reviewVariants(rawVariants(), brief), brief);
  assert.ok(csv.startsWith('\uFEFF'));
  assert.match(csv, /human|unreviewed draft/);
  assert.ok(csv.includes(source.offer));
  assert.ok(csv.includes(source.script));
});

test('selected angles and style references survive normalization and reach the prompt', () => {
  const brief = normalizeBrief({ ...source, angleIds: ['question', 'story'], references: [STARTER_REFERENCES[0]] });
  const prompt = buildPrompt(brief, 'json');
  const context = JSON.parse(prompt.user);
  assert.deepEqual(context.angleIds, ['question', 'story']);
  assert.equal(context.references[0].id, STARTER_REFERENCES[0].id);
  assert.equal(context.creativeAngles.length, 2);
  assert.match(prompt.system, /not proof of performance/);
  assert.match(prompt.system, /at most 2 per angle/);
  assert.deepEqual(variantSchema(brief).properties.variants.items.properties.angle.enum, ['question', 'story']);
});

test('invalid angle selections and oversized or duplicate references are rejected', () => {
  assert.throws(() => normalizeBrief({ ...source, angleIds: [] }), /at least one/);
  assert.throws(() => normalizeBrief({ ...source, angleIds: ['not-in-catalog'] }), /catalog/);
  assert.throws(() => normalizeBrief({ ...source, references: [STARTER_REFERENCES[0], STARTER_REFERENCES[0]] }), /unique/);
  assert.throws(() => normalizeBrief({ ...source, references: [{ ...STARTER_REFERENCES[0], script: 'x'.repeat(4001) }] }), /4000/);
});

test('unselected and overused angles cannot be approved', () => {
  const brief = normalizeBrief({ ...source, angleIds: ['question', 'story'] });
  const variants = rawVariants().map(variant => ({ ...variant, angle: 'question' }));
  variants[3].angle = 'gift';
  const result = reviewVariants(variants, brief);
  assert.ok(result[2].issues.some(issue => issue.code === 'overused_angle'));
  assert.ok(result[3].issues.some(issue => issue.code === 'unselected_angle'));
  assert.ok(result[2].blocked && result[3].blocked);
});

test('style references are not a source of permitted numerical claims', () => {
  const brief = normalizeBrief({ ...source, references: [{ id: 'fictional', title: 'Fictional example', script: 'A fictional scene promises a result in 90 minutes.', synthetic: true }] });
  const variants = rawVariants();
  variants[0].hook = 'Save 90 minutes every week.';
  assert.ok(reviewVariants(variants, brief)[0].issues.some(issue => issue.code === 'new_number'));
});