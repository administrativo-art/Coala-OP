import type { EmployeeEarningsRow } from '@/lib/goals-earnings';

export interface EarningsCsvEntry {
  group: string;
  unit: string;
  row: EmployeeEarningsRow;
}

function cell(value: string | number) {
  const text = typeof value === 'number' ? value.toFixed(2).replace('.', ',') : value;
  return /[";\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

/** Folha de premiação do mês, uma linha por colaborador em cada unidade. Separador `;` e BOM para abrir no Excel em pt-BR. */
export function buildEarningsCsv(entries: EarningsCsvEntry[], names: { user: (id: string) => string }): string {
  const header = ['Grupo', 'Unidade', 'Colaborador', 'Metas', 'Faturamento (R$)', 'Atingimento (%)', 'Premiação (R$)', 'Origem'];
  const lines = entries.map(({ group, unit, row }) => [
    group,
    unit,
    names.user(row.employeeId),
    String(row.periodCount),
    row.revenue,
    row.avgAttainment,
    row.prize,
    row.prizeCalculated > 0 ? 'calculada pela regra' : row.prize > 0 ? 'apurada no encerramento' : '',
  ].map(cell).join(';'));
  const total = entries.reduce((sum, { row }) => sum + row.prize, 0);
  lines.push(['Total', '', '', '', '', '', total, ''].map(cell).join(';'));
  return `﻿${[header.join(';'), ...lines].join('\r\n')}`;
}
