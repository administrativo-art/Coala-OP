type SplitAllocationEntry = {
  value: number;
  percentage: number;
};

function roundToHundredths(value: number) {
  return Number(value.toFixed(2));
}

export function calculateSplitValuesFromPercentages<TEntry extends SplitAllocationEntry>(
  entries: TEntry[],
  total: number,
) {
  const nextEntries = entries.map((entry) => ({
    ...entry,
    value: roundToHundredths(total * (Number(entry.percentage) || 0) / 100),
  }));
  const percentageTotal = entries.reduce((sum, entry) => sum + (Number(entry.percentage) || 0), 0);
  if (nextEntries.length > 0 && Math.abs(percentageTotal - 100) < 0.01) {
    const currentTotal = nextEntries.reduce((sum, entry) => sum + entry.value, 0);
    const lastIndex = nextEntries.length - 1;
    const lastEntry = nextEntries[lastIndex]!;
    nextEntries[lastIndex] = {
      ...lastEntry,
      value: roundToHundredths(lastEntry.value + total - currentTotal),
    };
  }
  return nextEntries;
}

export function calculateSplitPercentagesFromValues<TEntry extends SplitAllocationEntry>(
  entries: TEntry[],
  total: number,
) {
  if (total <= 0) return entries.map((entry) => ({ ...entry, percentage: 0 }));
  const nextEntries = entries.map((entry) => ({
    ...entry,
    percentage: roundToHundredths((Number(entry.value) || 0) / total * 100),
  }));
  const valueTotal = entries.reduce((sum, entry) => sum + (Number(entry.value) || 0), 0);
  if (nextEntries.length > 0 && Math.abs(valueTotal - total) < 0.01) {
    const percentageTotal = nextEntries.reduce((sum, entry) => sum + entry.percentage, 0);
    const lastIndex = nextEntries.length - 1;
    const lastEntry = nextEntries[lastIndex]!;
    nextEntries[lastIndex] = {
      ...lastEntry,
      percentage: roundToHundredths(lastEntry.percentage + 100 - percentageTotal),
    };
  }
  return nextEntries;
}
