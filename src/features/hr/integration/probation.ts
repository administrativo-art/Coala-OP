export const DEFAULT_PROBATION_CONFIG = {
  firstPeriodDays: 45,
  secondPeriodDays: 45,
  evaluationWindowDays: 10,
} as const;

export type ProbationConfig = {
  firstPeriodDays: number;
  secondPeriodDays: number;
  evaluationWindowDays: number;
};

export type ProbationPeriodSchedule = {
  days: number;
  startDate: string;
  endDate: string;
  evaluationStartDate: string;
  evaluationEndDate: string;
};

export type ProbationSchedule = {
  admissionDate: string;
  totalDays: number;
  firstPeriod: ProbationPeriodSchedule;
  secondPeriod: ProbationPeriodSchedule | null;
  finalEndDate: string;
};

const DATE_ONLY_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

function parseDateOnly(value: string) {
  if (!DATE_ONLY_PATTERN.test(value)) {
    throw new Error("Data inválida. Use YYYY-MM-DD.");
  }

  const [year, month, day] = value.split("-").map(Number);
  const date = new Date(Date.UTC(year, month - 1, day));
  if (
    date.getUTCFullYear() !== year ||
    date.getUTCMonth() !== month - 1 ||
    date.getUTCDate() !== day
  ) {
    throw new Error("Data inválida. Use uma data civil existente.");
  }
  return date;
}

function formatDateOnly(date: Date) {
  return date.toISOString().slice(0, 10);
}

export function addCalendarDays(date: string, days: number) {
  if (!Number.isInteger(days)) throw new Error("A quantidade de dias deve ser inteira.");
  const parsed = parseDateOnly(date);
  parsed.setUTCDate(parsed.getUTCDate() + days);
  return formatDateOnly(parsed);
}

export function validateProbationConfig(config: ProbationConfig) {
  const { firstPeriodDays, secondPeriodDays, evaluationWindowDays } = config;
  if (!Number.isInteger(firstPeriodDays) || firstPeriodDays < 1) {
    throw new Error("O primeiro período deve ter pelo menos 1 dia.");
  }
  if (!Number.isInteger(secondPeriodDays) || secondPeriodDays < 0) {
    throw new Error("O segundo período deve ser zero ou um número inteiro positivo.");
  }
  if (firstPeriodDays + secondPeriodDays > 90) {
    throw new Error("A soma dos períodos de experiência não pode ultrapassar 90 dias.");
  }
  if (!Number.isInteger(evaluationWindowDays) || evaluationWindowDays < 1) {
    throw new Error("A janela de avaliação deve ter pelo menos 1 dia.");
  }
  if (evaluationWindowDays > firstPeriodDays) {
    throw new Error("A janela de avaliação não pode ser maior que o primeiro período.");
  }
  if (secondPeriodDays > 0 && evaluationWindowDays > secondPeriodDays) {
    throw new Error("A janela de avaliação não pode ser maior que o segundo período.");
  }
  return config;
}

function buildPeriod(startDate: string, days: number, evaluationWindowDays: number): ProbationPeriodSchedule {
  const endDate = addCalendarDays(startDate, days - 1);
  return {
    days,
    startDate,
    endDate,
    evaluationStartDate: addCalendarDays(endDate, -(evaluationWindowDays - 1)),
    evaluationEndDate: endDate,
  };
}

export function buildProbationSchedule(admissionDate: string, input: ProbationConfig): ProbationSchedule {
  parseDateOnly(admissionDate);
  const config = validateProbationConfig({ ...input });
  const firstPeriod = buildPeriod(
    admissionDate,
    config.firstPeriodDays,
    config.evaluationWindowDays,
  );
  const secondPeriod = config.secondPeriodDays > 0
    ? buildPeriod(
        addCalendarDays(firstPeriod.endDate, 1),
        config.secondPeriodDays,
        config.evaluationWindowDays,
      )
    : null;

  return {
    admissionDate,
    totalDays: config.firstPeriodDays + config.secondPeriodDays,
    firstPeriod,
    secondPeriod,
    finalEndDate: secondPeriod?.endDate ?? firstPeriod.endDate,
  };
}
