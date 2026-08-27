export type BatchSimulationStatusValue = 'active' | 'archived';

export type BatchSimulationStatusUpdate = {
  action: 'keep' | 'set';
  value?: BatchSimulationStatusValue;
};

export function createBatchStatusUpdate(
  isStatusSelected: boolean,
  value?: BatchSimulationStatusValue,
): BatchSimulationStatusUpdate {
  return {
    action: isStatusSelected ? 'set' : 'keep',
    value,
  };
}

export function resolveBatchArchivedStatus(
  update: BatchSimulationStatusUpdate,
): boolean | undefined {
  if (update.action !== 'set' || !update.value) return undefined;
  return update.value === 'archived';
}
