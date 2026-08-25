type SalarySource = Record<string, unknown> | null | undefined;

function record(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
}

function numeric(value: unknown) {
  const parsed = typeof value === 'number' ? value : Number(value);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : null;
}

export function salaryFromRange(source: SalarySource) {
  const salaryRange = record(source?.salaryRange);
  const publicRange = record(source?.publicSalaryRange);
  return numeric(salaryRange.min) ?? numeric(publicRange.min);
}

export function salaryBaseFunctionId(source: SalarySource) {
  const calculation = record(source?.salaryCalculation);
  if (calculation.type !== 'base_plus_percentage') return null;
  return typeof calculation.baseFunctionId === 'string' && calculation.baseFunctionId.trim()
    ? calculation.baseFunctionId.trim()
    : null;
}

export function resolveConfiguredMonthlySalary(input: {
  jobFunction?: SalarySource;
  jobRole?: SalarySource;
  baseFunction?: SalarySource;
}) {
  const calculation = record(input.jobFunction?.salaryCalculation);
  if (calculation.type === 'base_plus_percentage') {
    const baseFunctionId = salaryBaseFunctionId(input.jobFunction);
    const percentage = numeric(calculation.additionalPercentage);
    const baseSalary = salaryFromRange(input.baseFunction);
    if (!baseFunctionId || percentage == null || baseSalary == null) return null;
    return Math.round(baseSalary * (1 + percentage / 100) * 100) / 100;
  }
  return salaryFromRange(input.jobFunction) ?? salaryFromRange(input.jobRole);
}
