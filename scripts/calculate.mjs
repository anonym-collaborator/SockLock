import { mkdir, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { resolve } from 'node:path';
import { BASELINE, SCENARIOS, calculateScenario, monthlyTokenCost } from '../src/economics.mjs';
import { csvCell } from '../src/core.mjs';

const output = fileURLToPath(new URL('../deliverables/', import.meta.url));
await mkdir(output, { recursive: true });
const scenarios = SCENARIOS.map(scenario => calculateScenario(scenario));
const report = {
  baseline: BASELINE,
  scenarios,
  noIncrementalSpend: calculateScenario({ ...SCENARIOS[1], realization: 0 }),
  hoursSensitivity: calculateScenario(SCENARIOS[1], 6 * 160 - 40 * 12),
  tokenEstimate: monthlyTokenCost(),
  warning: 'All future time savings, realization and marginal ROMI are assumptions. Historical 720 hours are not a staffing guarantee. EGP is not net profit or cash received this month.',
};
await writeFile(resolve(output, 'economics.json'), JSON.stringify(report, null, 2));
const fields = ['scenario', 'hours_per_modification', 'available_hours', 'capacity', 'extra_spend', 'marginal_romi', 'extra_egp', 'total_spend', 'total_romi'];
const rows = scenarios.map(result => [result.name, result.hours, result.availableHours, result.capacity, result.extraSpend.toFixed(2), result.marginalROMI, result.extraEGP.toFixed(2), result.totalSpend.toFixed(2), result.totalROMI.toFixed(4)]);
await writeFile(resolve(output, 'economics.csv'), '\uFEFF' + [fields, ...rows].map(row => row.map(csvCell).join(',')).join('\r\n'));
console.log(JSON.stringify(report, null, 2));