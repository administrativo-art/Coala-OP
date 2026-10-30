import type { ProbationProcessState } from '@/features/hr/integration/probation-process';
import { addCalendarDays } from '@/features/hr/integration/probation';
import { formatCivilDateBR } from '@/features/dp/employment-reference/presentation';

export function contractProbationDates(
  probation: ProbationProcessState | null | undefined,
  fallback: { firstEnd?: string | null; finalEnd?: string | null } = {},
) {
  const schedule = probation?.schedule;
  const effective = probation?.status === 'effective';
  const firstEnd = schedule?.firstPeriod.endDate ?? fallback.firstEnd ?? null;
  const finalEnd = schedule?.secondPeriod?.endDate ?? fallback.finalEnd ?? null;
  const lastEnd = schedule?.finalEndDate ?? finalEnd ?? firstEnd;
  // A previsão não efetiva o vínculo: também existe quando a decisão é manual.
  let indefiniteStart: string | null = null;
  if (lastEnd && probation?.status !== 'terminated') {
    try { indefiniteStart = addCalendarDays(lastEnd, 1); } catch { /* Data histórica inválida: não projetar. */ }
  }
  return {
    start: schedule?.firstPeriod.startDate ?? null,
    firstEnd,
    finalEnd,
    indefiniteStart,
    indefiniteLabel: effective ? 'Início do prazo indeterminado' : 'Início previsto do prazo indeterminado',
  };
}

export function ContractProbationDates({ probation, loading, error }: {
  probation: ProbationProcessState | null | undefined;
  loading?: boolean;
  error?: string;
}) {
  if (loading) return <p role="status" className="text-sm text-ds-ink-muted">Carregando dados da experiência…</p>;
  if (error) return <p role="alert" className="text-sm text-ds-danger">{error}</p>;
  const dates = contractProbationDates(probation);
  return <div className="space-y-2">
    <div className="grid gap-3 sm:grid-cols-2">
      {[
        ['Início da experiência', dates.start],
        ['Fim do 1º período de experiência', dates.firstEnd],
        ['Fim do 2º período de experiência', dates.finalEnd],
        [dates.indefiniteLabel, dates.indefiniteStart],
      ].map(([label, value]) => <div key={label} className="rounded-ds-sm border border-ds-border bg-ds-page p-3"><p className="text-xs font-bold text-ds-ink-muted">{label}</p><p className="mt-1 text-sm font-semibold">{value ? formatCivilDateBR(value) : 'Não informado'}</p></div>)}
    </div>
    <p className="text-xs text-ds-ink-muted">Datas calculadas a partir do processo de experiência vinculado. A admissão permanece como início do vínculo.</p>
  </div>;
}
