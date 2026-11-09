import test from 'node:test';
import assert from 'node:assert/strict';
import { SCENARIOS, calculateScenario, monthlyTokenCost } from '../src/economics.mjs';

test('scenario calculations use only the modification cohort spend', () => {
  const results = SCENARIOS.map(scenario => calculateScenario(scenario));
  assert.deepEqual(results.map(result => result.capacity), [300, 400, 450]);
  assert.deepEqual(results.map(result => Math.round(result.extraSpend)), [17250, 92000, 161000]);
  assert.deepEqual(results.map(result => Math.round(result.extraEGP)), [4313, 27600, 56350]);
});

test('more output produces no EGP if additional ad spend cannot be realized', () => {
  assert.equal(calculateScenario({ ...SCENARIOS[1], realization: 0 }).extraEGP, 0);
});

test('text-only automation cannot silently remove unchanged production time', () => {
  assert.throws(() => calculateScenario({ ...SCENARIOS[1], hours: 1.4 }), /unchanged/);
});

test('lower realistic staffing hours reduce the opportunity', () => {
  const result = calculateScenario(SCENARIOS[1], 480);
  assert.equal(result.capacity, 266);
  assert.ok(Math.abs(result.extraEGP - 4485) < 0.001);
});

test('negative marginal ROMI is represented as a loss, not hidden', () => {
  assert.ok(calculateScenario({ ...SCENARIOS[1], marginalROMI: 0.8 }).extraEGP < 0);
});

test('token budget follows published Haiku 4.5 input/output rates', () => {
  assert.equal(monthlyTokenCost().costUSD, 4.5);
});