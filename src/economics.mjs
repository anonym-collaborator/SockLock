export const BASELINE = Object.freeze({
  totalSpend: 400000,
  totalEGP: 140000,
  modificationSpend: 230000,
  modifications: 240,
  hoursPerModification: 3,
  historicalModificationHours: 720,
  unchangedHoursPerModification: 1.5,
  targetModifications: 500,
});

export const SCENARIOS = Object.freeze([
  { name: 'Pessimistic', hours: 2.4, realization: 0.3, marginalROMI: 1.25 },
  { name: 'Base', hours: 1.8, realization: 0.6, marginalROMI: 1.30 },
  { name: 'Optimistic', hours: 1.6, realization: 0.8, marginalROMI: 1.35 },
]);

export function calculateScenario(scenario, availableHours = BASELINE.historicalModificationHours) {
  if (!Number.isFinite(scenario.hours) || scenario.hours < BASELINE.unchangedHoursPerModification) {
    throw new Error('A text-only helper cannot remove the unchanged production hours.');
  }
  if (!Number.isFinite(availableHours) || availableHours < 0) throw new Error('Invalid available hours.');
  if (!Number.isFinite(scenario.realization) || scenario.realization < 0 || scenario.realization > 1) throw new Error('Realization must be between zero and one.');
  if (!Number.isFinite(scenario.marginalROMI) || scenario.marginalROMI < 0) throw new Error('Invalid marginal ROMI.');
  const capacity = Math.min(BASELINE.targetModifications, Math.floor(availableHours / scenario.hours));
  const extraModifications = Math.max(0, capacity - BASELINE.modifications);
  const spendPerModification = BASELINE.modificationSpend / BASELINE.modifications;
  const extraSpend = extraModifications * spendPerModification * scenario.realization;
  const extraEGP = extraSpend * (scenario.marginalROMI - 1);
  return {
    ...scenario,
    availableHours,
    capacity,
    extraModifications,
    spendPerModification,
    extraSpend,
    extraEGP,
    totalSpend: BASELINE.totalSpend + extraSpend,
    totalEGP: BASELINE.totalEGP + extraEGP,
    totalROMI: 1 + (BASELINE.totalEGP + extraEGP) / (BASELINE.totalSpend + extraSpend),
  };
}

export function monthlyTokenCost({ batches = 250, inputPerBatch = 8000, outputPerBatch = 2000 } = {}) {
  return { batches, inputTokens: batches * inputPerBatch, outputTokens: batches * outputPerBatch, costUSD: (batches * inputPerBatch + batches * outputPerBatch * 5) / 1000000 };
}